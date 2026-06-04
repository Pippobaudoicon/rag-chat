import { auth } from "@clerk/nextjs/server";
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
import { conversations, messages } from "@/lib/db/schema";
import {
  buildSystemPrompt,
  buildUserMessage,
  coerceResponseStyle,
} from "@/lib/rag/system-prompt";
import { getUserPreferences } from "@/lib/db/user-settings";
import {
  cacheKey,
  conversationTitleCacheKey,
  deriveConversationTitle,
  getSessionAnswerFromCache,
  getSlidingWindowRateLimit,
  invalidateConversationCaches,
  sessionAnswerCacheKey,
  setConversationTitleInCache,
  setInCache,
  setSessionAnswerInCache,
} from "@/lib/rag/cache";
import { createRagTools } from "@/lib/rag/tools";
import {
  getIndexLanguage,
  routeQueryLanguage,
} from "@/lib/rag/language-routing";
import { badRequestFromZod, chatRequestSchema } from "@/lib/api/validation";
import {
  createMemoryTools,
  getUserMemoryBrief,
} from "@/lib/memory/conversation-memory";
import { getBillingEntitlements } from "@/lib/billing/entitlements";
import {
  recordBillingUsage,
  setBillingUsageSnapshot,
} from "@/lib/billing/usage";
import type {
  AssistantVersion,
  ChatProgressData,
  SourceChunk,
  MessageDetails,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 180;

const DEFAULT_MAX_OUTPUT_TOKENS = 6000;
const DEFAULT_MAX_RESPONSE_SOURCES = 120;

const getPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const CHAT_MODEL = process.env.CHAT_MODEL ?? "deepseek/deepseek-v4-flash";
const MAX_OUTPUT_TOKENS = getPositiveInt(
  process.env.CHAT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS
);
const MAX_RESPONSE_SOURCES = getPositiveInt(
  process.env.CHAT_MAX_RESPONSE_SOURCES,
  DEFAULT_MAX_RESPONSE_SOURCES
);

export async function POST(req: Request) {
  const startTime = Date.now();
  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const { userId, has } = await auth();
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
    sources,
    responseStyle: requestedResponseStyle,
    topK,
    fixedChunks,
    regenerateQuestion,
    trigger,
    messageId,
  } = parsedBody.data;
  const entitlements = await getBillingEntitlements(userId, {
    hasPlan: (plan) => has({ plan }),
  });
  const effectiveTopK = Math.min(topK, entitlements.limits.maxTopK);

  const rateLimit = getSlidingWindowRateLimit(
    `chat:${entitlements.plan}`,
    entitlements.limits.chatRequests,
    entitlements.limits.window
  );
  if (rateLimit) {
    const rateLimitResult = await rateLimit.limit(`chat:${entitlements.plan}:${userId}`);
    if (!rateLimitResult.success) {
      return Response.json(
        {
          error: "Rate limit exceeded",
          plan: entitlements.plan,
          reset: rateLimitResult.reset,
          upgradeUrl: entitlements.isPro ? null : "/billing",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.max(1, Math.ceil((rateLimitResult.reset - Date.now()) / 1000))),
            "X-RateLimit-Limit": String(rateLimitResult.limit),
            "X-RateLimit-Remaining": String(rateLimitResult.remaining),
            "X-RateLimit-Reset": String(rateLimitResult.reset),
            "X-Subscription-Plan": entitlements.plan,
          },
        }
      );
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

  const isRegenerateRequest = trigger === "regenerate-message" || !!messageId;

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
  const validatedFixedChunks: SourceChunk[] = hasFixedChunks ? fixedChunks : [];

  // Chunks injected into the user message. Empty in the default flow; the
  // model populates the source list by calling tools during streaming.
  const initialChunks: SourceChunk[] = hasFixedChunks ? validatedFixedChunks : [];
  const toolChunksUsed: SourceChunk[] = [];
  let writeProgress: ((progress: ChatProgressData) => void) | null = null;

  const addToolChunks = (newChunks: SourceChunk[]) => {
    toolChunksUsed.push(...newChunks);
  };

  const getResponseSources = (): SourceChunk[] => {
    const merged = [...initialChunks, ...toolChunksUsed];
    return merged.filter(
      (chunk, idx, arr) => arr.findIndex((c) => c.id === chunk.id) === idx
    ).slice(0, MAX_RESPONSE_SOURCES);
  };

  const getToolNames = (steps: readonly { toolCalls?: readonly unknown[] }[]): string[] => {
    return [
      ...new Set(
        steps.flatMap((step) =>
          (step.toolCalls ?? []).flatMap((toolCall) => {
            if (!toolCall || typeof toolCall !== "object") return [];
            const { toolName } = toolCall as { toolName?: unknown };
            return typeof toolName === "string" && toolName.trim() ? [toolName] : [];
          })
        )
      ),
    ];
  };

  // ── 4. Conversation ownership ─────────────────────────────────────────────
  const db = getDb();
  let conversation = null;
  type StoredMessage = {
    id: number;
    role: string;
    content: string;
    sourcesJson: SourceChunk[] | null;
    versionsJson: AssistantVersion[] | null;
  };
  let storedMessages: StoredMessage[] = [];
  let targetAssistantMessage: StoredMessage | null = null;
  let createdConversationTitle: string | null = null;

  if (!conversationId && !question.trim()) {
    return new Response("Bad Request: empty question", { status: 400 });
  }

  if (conversationId) {
    conversation = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.id, conversationId),
        eq(conversations.clerkUserId, userId)
      ),
    });
    if (!conversation) {
      return new Response("Conversation not found", { status: 404 });
    }

    // Persist a per-conversation style override when the client sent a new one.
    if (
      requestedResponseStyle &&
      requestedResponseStyle !== conversation.responseStyle
    ) {
      await db
        .update(conversations)
        .set({ responseStyle: requestedResponseStyle })
        .where(eq(conversations.id, conversation.id));
      conversation.responseStyle = requestedResponseStyle;
    }

    storedMessages = await db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        sourcesJson: messages.sourcesJson,
        versionsJson: messages.versionsJson,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(asc(messages.createdAt));

    if (isRegenerateRequest && messageId) {
      const numericMessageId = Number(messageId);
      if (!Number.isNaN(numericMessageId)) {
        targetAssistantMessage =
          storedMessages.find(
            (msg) => msg.id === numericMessageId && msg.role === "assistant"
          ) ?? null;
      }

      if (!targetAssistantMessage) {
        targetAssistantMessage =
          [...storedMessages].reverse().find((msg) => msg.role === "assistant") ?? null;
      }

      // Fallback question resolution for regenerate requests where transport
      // does not include text in body.messages.
      if (!question.trim() && targetAssistantMessage) {
        const targetIndex = storedMessages.findIndex(
          (msg) => msg.id === targetAssistantMessage?.id
        );
        for (let i = targetIndex - 1; i >= 0; i -= 1) {
          if (storedMessages[i].role === "user") {
            question = storedMessages[i].content;
            break;
          }
        }
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
    return new Response("Bad Request: empty question", { status: 400 });
  }

  const languageRouting = await routeQueryLanguage(question, {
    indexLanguage: getIndexLanguage(),
    model: CHAT_MODEL,
  });

  // Retrieval caches use the translated index-language query. The UI language
  // is intentionally not part of search routing.
  const key = cacheKey(
    languageRouting.searchQuery,
    languageRouting.indexLanguage,
    sources,
    effectiveTopK
  );

  const historySignature = JSON.stringify(
    storedMessages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
    }))
  );
  const memoryBrief = await getUserMemoryBrief(userId);
  const answerCacheKey = conversation
    ? sessionAnswerCacheKey(userId, conversation.id, question, {
        language: [
          `ui:${uiLanguage}`,
          `answer:${languageRouting.inputLanguageCode}`,
          `index:${languageRouting.indexLanguage}`,
        ].join("|"),
        sources,
        topK: effectiveTopK,
        historySignature,
        memorySignature: memoryBrief.signature,
      })
    : null;

  // ── 5. Load conversation history for multi-turn memory ────────────────────
  // This is the key improvement over the Python single-turn RAG:
  // AI sees the full conversation history + fresh RAG context each turn.
  type ChatMessage = { role: "user" | "assistant"; content: string };
  const modelHistory: ChatMessage[] = [];

  if (conversation) {
    if (!isRegenerateRequest && answerCacheKey && !hasFixedChunks) {
      const cachedAnswer = await getSessionAnswerFromCache(answerCacheKey);
      if (cachedAnswer) {
        await db.insert(messages).values({
          conversationId: conversation.id,
          role: "user",
          content: question,
        });

        const cachedDetails: MessageDetails = {
          model: cachedAnswer.details?.model,
          finishReason: cachedAnswer.details?.finishReason,
          toolNames: cachedAnswer.details?.toolNames ?? [],
          latencyMs: Date.now() - startTime,
        };

        await db.insert(messages).values({
          conversationId: conversation.id,
          role: "assistant",
          content: cachedAnswer.text,
          sourcesJson: cachedAnswer.sources,
          versionsJson: [{ text: cachedAnswer.text, sources: cachedAnswer.sources }],
          detailsJson: cachedDetails,
        });

        if (!conversation.title) {
          const title = deriveConversationTitle(question);
          await db
            .update(conversations)
            .set({ title, updatedAt: new Date() })
            .where(eq(conversations.id, conversation.id));
          void setConversationTitleInCache(conversationTitleCacheKey(userId, conversation.id), title);
        } else {
          await db
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, conversation.id));
        }

        void invalidateConversationCaches(userId);

        const metadata = {
          sources: cachedAnswer.sources,
          details: cachedDetails,
        };

        const stream = createUIMessageStream({
          execute: ({ writer }) => {
            writer.write({ type: "start" });
            writer.write({ type: "start-step" });
            writer.write({ type: "text-start", id: "text-1" });
            writer.write({ type: "text-delta", id: "text-1", delta: cachedAnswer.text });
            writer.write({ type: "text-end", id: "text-1" });
            writer.write({ type: "message-metadata", messageMetadata: metadata });
            writer.write({ type: "finish-step" });
            writer.write({
              type: "finish",
              finishReason: cachedAnswer.details?.finishReason,
              messageMetadata: metadata,
            });
          },
          generateId,
        });

        return createUIMessageStreamResponse({ stream });
      }
    }

    if (!isRegenerateRequest) {
      // Persist the new user message immediately (before streaming starts)
      await db.insert(messages).values({
        conversationId: conversation.id,
        role: "user",
        content: question,
      });

      const historyWindow = storedMessages.slice(-20);
      modelHistory.push(...(historyWindow as ChatMessage[]));
    } else if (targetAssistantMessage) {
      const targetIndex = storedMessages.findIndex(
        (msg) => msg.id === targetAssistantMessage?.id
      );
      let priorUserIndex = -1;
      for (let i = targetIndex - 1; i >= 0; i -= 1) {
        if (storedMessages[i].role === "user") {
          priorUserIndex = i;
          break;
        }
      }

      // Keep context up to (but not including) the user turn being regenerated.
      if (priorUserIndex > 0) {
        modelHistory.push(...(storedMessages.slice(0, priorUserIndex) as ChatMessage[]));
      }
    }
  }

  // ── 6. Build (optionally) RAG-augmented message ───────────────────────────
  // In the default flow `initialChunks` is empty and the model is expected to
  // call a retrieval tool. Only the regenerate-with-fixed-chunks path injects
  // pre-selected context up front.
  const augmentedQuestion = buildUserMessage(question, initialChunks, {
    uiLanguage,
    inputLanguageCode: languageRouting.inputLanguageCode,
    inputLanguageName: languageRouting.inputLanguageName,
    indexLanguage: languageRouting.indexLanguage,
    indexLanguageName: languageRouting.indexLanguageName,
    searchQuery: languageRouting.searchQuery,
  });

  const chatMessages: ChatMessage[] = [...modelHistory, { role: "user", content: augmentedQuestion }];

  // Effective response style: per-conversation override → user default → system
  // default. The conversation override (if any) already reflects this turn's
  // requestedResponseStyle, which was persisted above.
  const conversationStyle = conversation?.responseStyle
    ? coerceResponseStyle(conversation.responseStyle)
    : null;
  const effectiveStyle =
    conversationStyle ?? (await getUserPreferences(userId)).defaultResponseStyle;

  const baseSystemPrompt = buildSystemPrompt(effectiveStyle);
  const systemPrompt = memoryBrief.prompt
    ? `${baseSystemPrompt}\n\nMemory brief:\n${memoryBrief.prompt}`
    : baseSystemPrompt;

  // ── 7. Stream with AI SDK v6 ──────────────────────────────────────────────
  const toolNamesUsed: string[] = [];

  const result = streamText({
    model: gateway(CHAT_MODEL),
    system: systemPrompt,
    messages: chatMessages,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    stopWhen: stepCountIs(8),
    tools: {
      ...createRagTools({
        language: languageRouting.indexLanguage,
        retrievalLanguageName: languageRouting.indexLanguageName,
        sources,
        topK: effectiveTopK,
        initialChunks,
        onSources: addToolChunks,
        onProgress: (progress) => writeProgress?.(progress),
      }),
      ...(conversation
        ? createMemoryTools({
            clerkUserId: userId,
          })
        : {}),
    },
    experimental_transform: smoothStream({
      delayInMs: 20,
      chunking: "word",
    }),

    onStepFinish: ({ toolCalls }) => {
      // Collect tool names as they execute during streaming
      (toolCalls ?? []).forEach((toolCall) => {
        if (toolCall && typeof toolCall === "object") {
          const { toolName } = toolCall as { toolName?: unknown };
          if (typeof toolName === "string" && toolName.trim() && !toolNamesUsed.includes(toolName)) {
            toolNamesUsed.push(toolName);
          }
        }
      });
    },

    onFinish: async ({ text, totalUsage, finishReason, steps }) => {
      // Build details object for persistence
      const details: MessageDetails = {
        inputTokens: totalUsage.inputTokens ?? undefined,
        outputTokens: totalUsage.outputTokens ?? undefined,
        totalTokens: totalUsage.totalTokens ?? undefined,
        reasoningTokens: totalUsage.outputTokenDetails?.reasoningTokens ?? undefined,
        latencyMs: Date.now() - startTime,
        model: CHAT_MODEL,
        finishReason,
        toolNames: getToolNames(steps),
      };

      // Update cache with the final assistant answer + tool-collected chunks.
      // The semantic_search tool warms the cache with chunks during retrieval;
      // here we overwrite that entry to also include the streamed answer text.
      // Skip caching for the regenerate-with-fixed-chunks path because the
      // cache key was not derived from a real retrieval in that case.
      if (!hasFixedChunks) {
        await setInCache(key, { chunks: getResponseSources(), answer: text });
      }

      if (answerCacheKey && !isRegenerateRequest && conversation && !hasFixedChunks) {
        await setSessionAnswerInCache(answerCacheKey, {
          text,
          sources: getResponseSources(),
          details: {
            model: CHAT_MODEL,
            finishReason,
            toolNames: getToolNames(steps),
          },
        });
      }

      // Persist assistant response + update conversation metadata
      if (conversation) {
        const responseSources = getResponseSources();

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

          await db
            .update(messages)
            .set({
              content: text,
              sourcesJson: responseSources,
              versionsJson: updatedVersions,
              detailsJson: details,
            })
            .where(eq(messages.id, targetAssistantMessage.id));
        } else {
          await db.insert(messages).values({
            conversationId: conversation.id,
            role: "assistant",
            content: text,
            sourcesJson: responseSources,
            versionsJson: [{ text, sources: responseSources }],
            detailsJson: details,
          });
        }

        // Auto-title from first question (≤60 chars, break at word boundary)
        if (!conversation.title && !isRegenerateRequest) {
          const title = deriveConversationTitle(question);
          await db
            .update(conversations)
            .set({ title, updatedAt: new Date() })
            .where(eq(conversations.id, conversation.id));
          await setConversationTitleInCache(conversationTitleCacheKey(userId, conversation.id), title);
        } else {
          await db
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, conversation.id));
        }

        await invalidateConversationCaches(userId);
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
        conversationId: conversation?.id,
        title: createdConversationTitle ?? conversation?.title ?? undefined,
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
                inputTokens: part.totalUsage.inputTokens ?? undefined,
                outputTokens: part.totalUsage.outputTokens ?? undefined,
                totalTokens: part.totalUsage.totalTokens ?? undefined,
                reasoningTokens: part.totalUsage.outputTokenDetails?.reasoningTokens ?? undefined,
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

  return createUIMessageStreamResponse({ stream });
}
