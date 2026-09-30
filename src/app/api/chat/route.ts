import { getViewer, isGuestId } from "@/lib/auth/guest";
import { after } from "next/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  generateId,
  gateway,
  stepCountIs,
  smoothStream,
} from "ai";
import { eq, and, asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations, messages, type Conversation } from "@/lib/db/schema";
import {
  buildSystemPrompt,
  buildUserMessage,
  coerceResponseStyle,
} from "@/lib/rag/system-prompt";
import { getUserPreferences } from "@/lib/db/user-settings";
import { deriveConversationTitle } from "@/lib/rag/cache";
import { createRagTools } from "@/lib/rag/tools";
import { createLatencyTrace, withToolTiming } from "@/lib/observability/latency";
import { getIndexLanguage } from "@/lib/rag/language-routing";
import { retrievalFlagsSignature } from "@/lib/rag/flags";
import { prepareChatToolStep } from "@/lib/rag/tool-loop-policy";
import { badRequestFromZod, chatRequestSchema } from "@/lib/api/validation";
import {
  createMemoryTools,
  getUserMemoryBrief,
} from "@/lib/memory/conversation-memory";
import { getSessionEntitlements } from "@/lib/billing/entitlements";
import {
  recordBillingUsage,
  setBillingUsageSnapshot,
} from "@/lib/billing/usage";
import {
  isChatGenerationActive,
  isChatGenerationStale,
  matchesChatGenerationSnapshot,
  resolvePersistedUserTurn,
} from "@/lib/chat/generation";
import {
  getChatStreamContext,
} from "@/lib/chat/resumable-stream";
import { getChatRateLimiter, rateLimitedResponse } from "@/lib/chat/rate-limit";
import {
  claimGeneration,
  completeGenerationUpdate,
  markGenerationError,
  ownedActiveTurn,
  recoverStaleGeneration,
  releasePendingInitialTurn as releasePendingTurn,
} from "@/lib/chat/turn-store";
import { extractCitationMarkers } from "@/lib/rag/citation-markers";
import {
  findRegenerateTarget,
  gatewayDetails,
  getToolNames,
  toRetrievalToolEvent,
  uniqueSources,
  usageDetails,
  userTurnIndexBefore,
} from "@/lib/chat/turn";
import { ALL_SOURCES } from "@/lib/types";
import type {
  AssistantVersion,
  ChatProgressData,
  SourceChunk,
  MessageDetails,
  RetrievalToolEvent,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 180;

const DEFAULT_MAX_OUTPUT_TOKENS = 6000;
const DEFAULT_MAX_RESPONSE_SOURCES = 50;
const DEFAULT_FREE_MAX_RESPONSE_SOURCES = 10;
const MAX_RETRIEVAL_CALLS = 2;

const getPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const CHAT_MODEL = process.env.CHAT_MODEL ?? "deepseek/deepseek-v4.1-flash";
const MAX_OUTPUT_TOKENS = getPositiveInt(
  process.env.CHAT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS
);
const MAX_RESPONSE_SOURCES = getPositiveInt(
  process.env.CHAT_MAX_RESPONSE_SOURCES,
  DEFAULT_MAX_RESPONSE_SOURCES
);
const FREE_MAX_RESPONSE_SOURCES = getPositiveInt(
  process.env.SUBSCRIPTION_FREE_MAX_RESPONSE_SOURCES,
  DEFAULT_FREE_MAX_RESPONSE_SOURCES
);

export async function POST(req: Request) {
  const startTime = Date.now();
  // High-resolution clock for the latency trace (independent phase durations +
  // milestones). `startTime` (wall clock) is kept for the legacy latencyMs field.
  const latency = createLatencyTrace(performance.now());
  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const { userId, has } = await latency.phase("auth", () => getViewer());
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  const parsedBody = chatRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return badRequestFromZod(parsedBody.error);
  }

  const {
    messages: uiMessages = [],
    conversationId,
    language: uiLanguage,
    sources: requestedSources,
    responseStyle: requestedResponseStyle,
    topK,
    fixedChunks,
    regenerateQuestion,
    trigger,
    messageId,
    persistedUserMessageId,
  } = parsedBody.data;

  // Early gates that reject the request free the first turn's pending marker.
  const releasePendingInitialTurn = () =>
    releasePendingTurn(conversationId, persistedUserMessageId, userId);

  const entitlements = getSessionEntitlements(userId, (plan) => has({ plan }));
  const effectiveTopK = Math.min(topK, entitlements.limits.maxTopK);
  // Free and guest answers show at most FREE_MAX_RESPONSE_SOURCES sources in total, across every retrieval in the turn.
  const maxResponseSources = entitlements.isPro
    ? MAX_RESPONSE_SOURCES
    : Math.min(MAX_RESPONSE_SOURCES, FREE_MAX_RESPONSE_SOURCES);
  // "Super" (every namespace) is a signed-in feature; guests stay on the standard set.
  const sources =
    entitlements.plan === "guest"
      ? requestedSources.filter((source) => ALL_SOURCES.includes(source))
      : requestedSources;

  const limitChatRequest = getChatRateLimiter(entitlements);
  if (limitChatRequest) {
    const rateLimitResult = await latency
      .phase("ratelimit", () => limitChatRequest(req, userId))
      .catch(async (error) => {
        await releasePendingInitialTurn();
        throw error;
      });
    if (!rateLimitResult.success) {
      await releasePendingInitialTurn();
      return rateLimitedResponse(rateLimitResult, entitlements);
    }

    after(() =>
      setBillingUsageSnapshot(userId, "chat", {
        used: Math.max(0, rateLimitResult.limit - rateLimitResult.remaining),
        limit: rateLimitResult.limit,
        remaining: rateLimitResult.remaining,
        window: entitlements.limits.window,
        resetAt: rateLimitResult.reset,
      })
    );
  }

  after(() =>
    recordBillingUsage(
      userId,
      "chat",
      entitlements.limits.chatRequests,
      entitlements.limits.window
    )
  );

  // Only the trigger marks a regenerate: "Try again" resends the history with the
  // last message's id as a submit, and must answer that question as a new turn.
  const isRegenerateRequest = trigger === "regenerate-message";

  // Extract latest user question from UIMessage parts (AI SDK v6 format)
  const lastMessage = uiMessages.at(-1);
  let question: string =
    lastMessage?.parts?.find((p: { type: string }) => p.type === "text")?.text ??
    lastMessage?.content ??
    regenerateQuestion ??
    "";

  // ── 3. Source selection (no eager retrieval) ─────────────────────────────
  // Retrieval is delegated to RAG tools (`semantic_search`,
  // `lookup_scripture_passage`, `search_conference_talks`). The model decides
  // which retrieval path is appropriate for the question and runs it exactly
  // once per turn — eliminating the previous double-retrieval (eager + tool).
  // The only path that still bypasses tools is the "fixed chunks" regenerate
  // case, where the user explicitly wants to reuse previously retrieved
  // sources.
  const hasFixedChunks =
    Array.isArray(fixedChunks) && fixedChunks.length > 0;
  const validatedFixedChunks: SourceChunk[] = hasFixedChunks
    ? fixedChunks.slice(0, maxResponseSources)
    : [];

  // Chunks injected into the user message: only the fixed-chunks regenerate
  // case; otherwise the model populates the source list by calling tools
  // during streaming.
  const initialChunks: SourceChunk[] = hasFixedChunks ? validatedFixedChunks : [];
  const toolChunksUsed: SourceChunk[] = [];
  const retrievalToolEvents: RetrievalToolEvent[] = [];
  let writeProgress: ((progress: ChatProgressData) => void) | null = null;

  const addToolChunks = (newChunks: SourceChunk[]) => {
    toolChunksUsed.push(...newChunks);
  };

  const getResponseSources = (): SourceChunk[] =>
    uniqueSources([...initialChunks, ...toolChunksUsed], maxResponseSources);

  // ── 4. Preamble: ownership gate, then independent reads concurrently ───────
  // The 401/429 gates (auth, ratelimit) already resolved above. We resolve the
  // conversation OWNERSHIP gate next — a single indexed lookup — so a deleted
  // or unowned conversationId returns 404 promptly, before we issue the routing
  // LLM call or the memory/prefs reads (and without one of those failing or
  // stalling and masking the 404; codex review). Everything that depends only
  // on a valid, owned request then runs in one Promise.all instead of a serial
  // await chain, so `preStreamMs` collapses from the sum of those phases toward
  // their max.
  const db = getDb();
  type StoredMessage = {
    id: number;
    role: string;
    content: string;
    sourcesJson: SourceChunk[] | null;
    versionsJson: AssistantVersion[] | null;
  };

  // Reject an empty new-chat question before doing any work or writes.
  if (!conversationId && !question.trim()) {
    return new Response("Bad Request: empty question", { status: 400 });
  }

  // Ownership gate: resolve (and 404) before any parallel work. New chats have
  // no conversation to load — they are created below, post-gate.
  let conversation: Conversation | null = null;
  if (conversationId) {
    conversation =
      (await latency
        .phase("convLoad", () =>
          db.query.conversations.findFirst({
            where: and(
              eq(conversations.id, conversationId),
              eq(conversations.clerkUserId, userId)
            ),
          })
        )
        .catch(async (error) => {
          await releasePendingInitialTurn();
          throw error;
        })) ?? null;
    if (!conversation) {
      return new Response("Conversation not found", { status: 404 });
    }
  }

  // Independent reads behind the ownership gate: messages load (only when a
  // conversation exists), memory brief, and user prefs. Global language routing
  // is gone — no per-turn translation LLM call. Retrieval-query translation is
  // now lazy, inside the English-corpus tools, so a no-tool turn pays nothing.
  // The `ownedConversation` const snapshot keeps the closure's non-null narrowing.
  const ownedConversation = conversation;
  const [storedMessages, memoryBrief, userPreferences] = await Promise.all([
    ownedConversation
      ? latency.phase("messagesLoad", () =>
          db
            .select({
              id: messages.id,
              role: messages.role,
              content: messages.content,
              sourcesJson: messages.sourcesJson,
              versionsJson: messages.versionsJson,
            })
            .from(messages)
            .where(eq(messages.conversationId, ownedConversation.id))
            .orderBy(asc(messages.createdAt), asc(messages.id))
        )
      : Promise.resolve([] as StoredMessage[]),
    latency.phase("memoryBrief", () => getUserMemoryBrief(userId)),
    latency.phase("prefs", () => getUserPreferences(userId)),
  ]).catch(async (error) => {
    await releasePendingInitialTurn();
    throw error;
  });

  let targetAssistantMessage: StoredMessage | null = null;
  let createdConversationTitle: string | null = null;

  if (conversationId) {
    if (isRegenerateRequest && messageId) {
      targetAssistantMessage = findRegenerateTarget(storedMessages, messageId);

      // Fallback question resolution for regenerate requests where transport
      // does not include text in body.messages.
      if (!question.trim() && targetAssistantMessage) {
        const userIndex = userTurnIndexBefore(storedMessages, targetAssistantMessage.id);
        if (userIndex >= 0) question = storedMessages[userIndex].content;
      }
    }
  } else {
    const [createdConversation] = await db
      .insert(conversations)
      .values({
        clerkUserId: userId,
        language: uiLanguage,
        sources,
        responseStyle: requestedResponseStyle ?? null,
      })
      .returning();

    conversation = createdConversation;
    createdConversationTitle = deriveConversationTitle(question);
  }

  if (!question.trim()) {
    await releasePendingInitialTurn();
    return new Response("Bad Request: empty question", { status: 400 });
  }

  const { currentMessage: persistedUserMessage, priorMessages: priorStoredMessages } =
    resolvePersistedUserTurn(
      storedMessages,
      isRegenerateRequest ? undefined : persistedUserMessageId,
      question
    );

  if (persistedUserMessageId && !persistedUserMessage) {
    await releasePendingInitialTurn();
    return new Response("Persisted user message not found", { status: 400 });
  }

  if (
    conversation &&
    isChatGenerationStale(
      conversation.generationStatus,
      conversation.generationStartedAt,
      Date.now(),
      conversation.activeTurnId === null
    )
  ) {
    await recoverStaleGeneration(conversation, userId);
  }

  // A first-turn conversation is exposed in the sidebar before /api/chat starts
  // as streaming + activeTurnId=null. Only the request carrying its verified
  // tail user row may turn that pending marker into a server-owned claim.
  const hasPendingInitialTurn =
    !!conversation &&
    !isRegenerateRequest &&
    !!persistedUserMessage &&
    conversation.generationStatus === "streaming" &&
    conversation.activeTurnId === null;

  if (
    conversation &&
    isChatGenerationActive(conversation.generationStatus) &&
    !isChatGenerationStale(
      conversation.generationStatus,
      conversation.generationStartedAt,
      Date.now(),
      conversation.activeTurnId === null
    ) &&
    !hasPendingInitialTurn
  ) {
    return new Response("A response is already being generated", { status: 409 });
  }

  const indexLanguage = getIndexLanguage();

  if (!conversation) {
    return new Response("Conversation not found", { status: 404 });
  }

  const turnId = generateId();
  const streamContext = getChatStreamContext();
  const activeStreamId = streamContext ? generateId() : null;
  const claimed = await claimGeneration({
    conversationId: conversation.id,
    userId,
    turnId,
    activeStreamId,
    fromPendingInitialTurn: hasPendingInitialTurn,
  });

  if (!claimed) {
    return new Response("A response is already being generated", { status: 409 });
  }

  const markGenerationErrorSafely = () =>
    markGenerationError(conversation.id, userId, turnId);

  try {
    // Persist this turn's style override only after the generation claim, so a
    // concurrent request that loses the claim cannot mutate the conversation.
    if (
      requestedResponseStyle &&
      requestedResponseStyle !== conversation.responseStyle
    ) {
      await db
        .update(conversations)
        .set({ responseStyle: requestedResponseStyle })
        .where(ownedActiveTurn(conversation.id, userId, turnId));
      conversation.responseStyle = requestedResponseStyle;
    }

  // ── 5. Load conversation history for multi-turn memory ────────────────────
  // This is the key improvement over the Python single-turn RAG:
  // AI sees the full conversation history + fresh RAG context each turn.
  type ChatMessage = { role: "user" | "assistant"; content: string };
  const modelHistory: ChatMessage[] = [];

  if (conversation) {
    if (!isRegenerateRequest) {
      // Persist the user turn and make the conversation visible in the sidebar
      // before retrieval or model generation can delay the request.
      if (!persistedUserMessage) {
        await latency.phase("userMsgInsert", () =>
          db.insert(messages).values({
            conversationId: conversation!.id,
            role: "user",
            content: question,
          })
        );
      }

      const title = conversation.title ?? deriveConversationTitle(question);
      await db
        .update(conversations)
        .set({ title, updatedAt: new Date() })
        .where(ownedActiveTurn(conversation.id, userId, turnId));
      if (!conversation.title) {
        conversation.title = title;
        createdConversationTitle = title;
      }

      const historyWindow = priorStoredMessages.slice(-20);
      modelHistory.push(...(historyWindow as ChatMessage[]));
    }

    if (isRegenerateRequest && targetAssistantMessage) {
      const priorUserIndex = userTurnIndexBefore(storedMessages, targetAssistantMessage.id);

      // Keep context up to (but not including) the user turn being regenerated.
      if (priorUserIndex > 0) {
        modelHistory.push(...(storedMessages.slice(0, priorUserIndex) as ChatMessage[]));
      }
    }
  }

  // ── 6. Build (optionally) RAG-augmented message ───────────────────────────
  // In the default flow `initialChunks` is empty and the model is expected to
  // call a retrieval tool. The regenerate-with-fixed-chunks path injects
  // pre-selected context up front.
  const augmentedQuestion = buildUserMessage(
    question,
    initialChunks,
    {
      uiLanguage,
    }
  );

  const chatMessages: ChatMessage[] = [...modelHistory, { role: "user", content: augmentedQuestion }];

  // Effective response style: per-conversation override → user default → system
  // default. The conversation override (if any) already reflects this turn's
  // requestedResponseStyle, which was persisted above.
  const conversationStyle = conversation?.responseStyle
    ? coerceResponseStyle(conversation.responseStyle)
    : null;
  const effectiveStyle =
    conversationStyle ?? userPreferences.defaultResponseStyle;

  const baseSystemPrompt = buildSystemPrompt(effectiveStyle);
  const systemPrompt = memoryBrief
    ? `${baseSystemPrompt}\n\nMemory brief:\n${memoryBrief}`
    : baseSystemPrompt;

  // ── 7. Stream with AI SDK v6 ──────────────────────────────────────────────
  const toolNamesUsed: string[] = [];

  // Wrap every tool's execute to record per-tool name / wall-time / success into
  // the latency trace (covers retrieval tools and memory).
  const chatTools = withToolTiming(
    {
      ...createRagTools({
        language: indexLanguage,
        sources,
        topK: effectiveTopK,
        initialChunks,
        maxChunks: maxResponseSources,
        // Free/guest turns share one small source cap; a second parallel call would only race the first for it.
        maxRetrievalCalls: entitlements.isPro ? MAX_RETRIEVAL_CALLS : 1,
        onSources: addToolChunks,
        onProgress: (progress) => {
          // A tool's terminal "tools" event carries its result stats — capture
          // them for the persisted retrieval trace, then forward to the stream.
          if (progress.phase === "tools" && progress.toolName) {
            retrievalToolEvents.push(toRetrievalToolEvent(progress));
          }
          writeProgress?.(progress);
        },
      }),
      ...(conversation && !isGuestId(userId)
        ? createMemoryTools({
            clerkUserId: userId,
          })
        : {}),
    },
    latency.addTool
  );

  // Per-step INCLUSIVE wall time: elapsed since the previous step boundary (or
  // stream start for step 1). onStepFinish fires after in-step tool execution, so
  // this includes tool time, not just model decode. `preStreamMs` is the last
  // thing recorded before streaming.
  let stepIndex = 0;
  let lastStepMark = performance.now();
  latency.milestone("preStreamMs");

  const result = streamText({
    model: gateway(CHAT_MODEL),
    system: systemPrompt,
    messages: chatMessages,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    stopWhen: stepCountIs(4),
    tools: chatTools,
    prepareStep: ({ steps }) => {
      const policy = prepareChatToolStep(steps, hasFixedChunks);
      if (!policy) return undefined;

      const stepInstruction =
        "Tool use is complete. Produce the final user-facing answer now using the retrieved or preloaded sources. Do not emit tool-call syntax, XML, DSML, or another tool request.";

      return {
        ...policy,
        system: `${systemPrompt}\n\n${stepInstruction}`,
      };
    },
    experimental_transform: smoothStream({
      delayInMs: 20,
      chunking: "word",
    }),

    onChunk: ({ chunk }) => {
      // First visible-text + tool-call milestones (set-once). The empty
      // tool-decision turn is firstToolCallMs − preStreamMs (the cost we plan to
      // cut); firstToolCallMs → serverFirstTextMs is retrieval + later
      // model work, not the decision itself.
      latency.milestone("firstModelChunkMs");
      if (chunk.type === "tool-call") {
        latency.milestone("firstToolCallMs");
        writeProgress?.({ phase: "tools", toolName: chunk.toolName });
      }
      if (chunk.type === "text-delta") latency.milestone("serverFirstTextMs");
    },

    onStepFinish: ({ toolCalls, finishReason }) => {
      const nowMark = performance.now();
      latency.addStep({
        index: stepIndex,
        wallMs: Math.round(nowMark - lastStepMark),
        finishReason,
        toolCalls: (toolCalls ?? []).length,
      });
      stepIndex += 1;
      lastStepMark = nowMark;

      // Collect tool names as they execute during streaming
      (toolCalls ?? []).forEach((toolCall) => {
        if (toolCall && typeof toolCall === "object") {
          const { toolName } = toolCall as { toolName?: unknown };
          if (typeof toolName === "string" && toolName.trim() && !toolNamesUsed.includes(toolName)) {
            toolNamesUsed.push(toolName);
          }
        }
      });

      // Tool execution is complete and the next model step is reasoning over
      // the result. Without this transition clients remain misleadingly stuck
      // on "using tools" while the answer is actually being drafted.
      if ((toolCalls ?? []).length > 0) {
        writeProgress?.({ phase: "drafting", toolCompleted: true });
      }
    },

    onError: async () => {
      await markGenerationErrorSafely();
    },

    onFinish: async ({ totalUsage, finishReason, steps }) => {
      // Persist what streamed: the pre-tool progress sentence plus the answer
      // (onFinish's `text` is only the final step).
      const text = steps.map((step) => step.text).filter(Boolean).join("\n\n");
      try {
      const currentGeneration = await db.query.conversations.findFirst({
        columns: { generationStatus: true, activeTurnId: true },
        where: and(
          eq(conversations.id, conversation.id),
          eq(conversations.clerkUserId, userId)
        ),
      });
      if (
        !currentGeneration ||
        !matchesChatGenerationSnapshot(
          currentGeneration.generationStatus,
          currentGeneration.activeTurnId,
          turnId
        )
      ) {
        return;
      }

      // Generation finished; the cache/DB writes below are not included here.
      latency.milestone("answerReadyMs");
      const latencyTrace = latency.build(
        isRegenerateRequest ? "regenerate" : "generated"
      );
      // Fold each retrieval tool's cache-hit flag onto its timed entry so a
      // single tools[] array carries duration + success + cacheHit.
      if (latencyTrace.tools) {
        for (const event of retrievalToolEvents) {
          const match = latencyTrace.tools.find(
            (t) => t.name === event.toolName && t.cacheHit === undefined
          );
          if (match) match.cacheHit = event.cacheHit;
        }
      }

      // Build details object for persistence
      const citedIndices = extractCitationMarkers(text);
      const details: MessageDetails = {
        ...usageDetails(totalUsage),
        ...gatewayDetails(steps),
        // Zero-token citation check (monitoring only; the text is not changed).
        citations: {
          cited: citedIndices.length,
          outOfRange: citedIndices.filter((n) => n > getResponseSources().length),
        },
        latencyMs: Date.now() - startTime,
        model: CHAT_MODEL,
        finishReason,
        toolNames: getToolNames(steps),
        // Retrieval trace: how this turn retrieved (flags + per-tool stats), so
        // real conversations can be mined into the eval gold set.
        retrieval: {
          indexLanguage,
          sources,
          topK: effectiveTopK,
          flags: retrievalFlagsSignature(),
          tools: retrievalToolEvents,
        },
        latency: latencyTrace,
      };

      // Persist assistant response + update conversation metadata.
      const responseSources = getResponseSources();
      const completeConversation = completeGenerationUpdate(conversation.id, userId, turnId);

      if (isRegenerateRequest && targetAssistantMessage) {
        const existingVersions =
          targetAssistantMessage.versionsJson && targetAssistantMessage.versionsJson.length > 0
            ? targetAssistantMessage.versionsJson
            : [
                {
                  text: targetAssistantMessage.content,
                  sources: targetAssistantMessage.sourcesJson ?? [],
                },
              ];

        const updatedVersions: AssistantVersion[] = [
          ...existingVersions,
          { text, sources: responseSources },
        ];

        await db.batch([
          db
            .update(messages)
            .set({
              content: text,
              sourcesJson: responseSources,
              versionsJson: updatedVersions,
              detailsJson: details,
            })
            .where(eq(messages.id, targetAssistantMessage.id)),
          completeConversation,
        ]);
      } else {
        await db.batch([
          db.insert(messages).values({
            conversationId: conversation.id,
            role: "assistant",
            content: text,
            sourcesJson: responseSources,
            versionsJson: [{ text, sources: responseSources }],
            detailsJson: details,
          }),
          completeConversation,
        ]);
      }
      } catch (error) {
        await markGenerationErrorSafely();
        throw error;
      }
    },
  });

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writeProgress = (progress) => {
        writer.write({
          type: "data-chat-progress",
          id: "chat-progress",
          data: {
            elapsedMs: Date.now() - startTime,
            ...progress,
          },
          transient: true,
        });
      };

      writeProgress({
        phase: "queued",
        conversationId: conversation.id,
        title: createdConversationTitle ?? conversation.title ?? undefined,
        turnId,
      });
      writeProgress({ phase: "drafting" });

      // toUIMessageStream() is required for AI Elements <Message> component.
      // Include sources in message metadata so the UI can display source cards.
      writer.merge(
        result.toUIMessageStream({
          generateMessageId: generateId,
          messageMetadata: ({ part }) => {
            if (part.type === "finish") {
              const details: MessageDetails = {
                ...usageDetails(part.totalUsage),
                latencyMs: Date.now() - startTime,
                model: CHAT_MODEL,
                finishReason: part.finishReason,
                toolNames: toolNamesUsed,
              };
              return { sources: getResponseSources(), details };
            }
            return undefined;
          },
        })
      );
    },
    generateId,
    onFinish: () => {
      writeProgress = null;
    },
  });

  if (!streamContext || !activeStreamId) {
    // Keep the model stream alive after a browser disconnect even when Redis is
    // unavailable. Returning to the conversation then polls the persisted state.
    after(Promise.resolve(result.consumeStream()));
  }

  let streamSetupPromise: Promise<void> | null = null;
  const response = createUIMessageStreamResponse({
    stream,
    consumeSseStream:
      streamContext && activeStreamId
        ? ({ stream: sseStream }) => {
            streamSetupPromise = streamContext
              .createNewResumableStream(activeStreamId, () => sseStream)
              .then(() => undefined);
            return streamSetupPromise;
          }
        : undefined,
  });

  if (streamSetupPromise) await streamSetupPromise;
  return response;
  } catch (error) {
    await markGenerationErrorSafely();
    throw error;
  }
}
