import { auth } from "@clerk/nextjs/server";
import { streamText, generateId, gateway, stepCountIs, smoothStream } from "ai";
import { eq, and, asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { SYSTEM_PROMPT, buildUserMessage } from "@/lib/rag/system-prompt";
import { cacheKey, setInCache } from "@/lib/rag/cache";
import { createRagTools } from "@/lib/rag/tools";
import { badRequestFromZod, chatRequestSchema } from "@/lib/api/validation";
import {
  createMemoryTools,
  getUserMemoryContext,
} from "@/lib/memory/conversation-memory";
import type { AssistantVersion, Language, SourceChunk, MessageDetails } from "@/lib/types";

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
  const { userId } = await auth();
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
    language,
    sources,
    topK,
    fixedChunks,
    regenerateQuestion,
    trigger,
    messageId,
  } = parsedBody.data;

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

  // Cache key for the final answer (chunks come from tool calls).
  const key = cacheKey(question, language, sources, topK);

  // Chunks injected into the user message. Empty in the default flow; the
  // model populates the source list by calling tools during streaming.
  const initialChunks: SourceChunk[] = hasFixedChunks ? validatedFixedChunks : [];
  const toolChunksUsed: SourceChunk[] = [];

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
  }

  if (!question.trim()) {
    return new Response("Bad Request: empty question", { status: 400 });
  }

  // ── 5. Load conversation history for multi-turn memory ────────────────────
  // This is the key improvement over the Python single-turn RAG:
  // AI sees the full conversation history + fresh RAG context each turn.
  type ChatMessage = { role: "user" | "assistant"; content: string };
  const modelHistory: ChatMessage[] = [];

  if (conversation) {
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
  const augmentedQuestion = buildUserMessage(question, initialChunks, language);

  const chatMessages: ChatMessage[] = [...modelHistory, { role: "user", content: augmentedQuestion }];
  const memoryContext = await getUserMemoryContext(userId);
  const systemPrompt = memoryContext
    ? `${SYSTEM_PROMPT}\n\n${memoryContext}`
    : SYSTEM_PROMPT;

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
        language,
        sources,
        topK,
        initialChunks,
        onSources: addToolChunks,
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
          let title = question.slice(0, 60);
          if (question.length > 60) {
            const lastSpace = title.lastIndexOf(" ");
            title = (lastSpace > 20 ? title.slice(0, lastSpace) : title) + "…";
          }
          await db
            .update(conversations)
            .set({ title, updatedAt: new Date() })
            .where(eq(conversations.id, conversation.id));
        } else {
          await db
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, conversation.id));
        }
      }
    },
  });

  // toUIMessageStreamResponse() is required for AI Elements <Message> component
  // Include sources in the message metadata so UI can display them
  return result.toUIMessageStreamResponse({
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
  });
}
