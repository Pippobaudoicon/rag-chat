import { auth } from "@clerk/nextjs/server";
import { streamText, generateId, gateway, stepCountIs, smoothStream } from "ai";
import { eq, and, asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { retrieve } from "@/lib/rag/retriever";
import { SYSTEM_PROMPT, buildUserMessage } from "@/lib/rag/system-prompt";
import { cacheKey, getFromCache, setInCache } from "@/lib/rag/cache";
import { createRagTools } from "@/lib/rag/tools";
import { badRequestFromZod, chatRequestSchema } from "@/lib/api/validation";
import type { AssistantVersion, SourceType, Language, SourceChunk, MessageDetails } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const CHAT_MODEL = process.env.CHAT_MODEL ?? "openai/gpt-4o-mini";

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

  // ── 3. Source selection / cache check ─────────────────────────────────────
  const hasFixedChunks =
    Array.isArray(fixedChunks) &&
    fixedChunks.length > 0;
  const validatedFixedChunks: SourceChunk[] = hasFixedChunks ? fixedChunks : [];

  const key = cacheKey(question, language, sources, topK);
  const cached = hasFixedChunks ? null : await getFromCache(key);
  const chunks: SourceChunk[] = hasFixedChunks
    ? validatedFixedChunks
    : (cached?.chunks ?? await retrieve(question, sources, language, topK));
  const toolChunksUsed: SourceChunk[] = [];

  const addToolChunks = (newChunks: SourceChunk[]) => {
    toolChunksUsed.push(...newChunks);
  };

  const getResponseSources = (): SourceChunk[] => {
    const merged = [...chunks, ...toolChunksUsed];
    return merged.filter(
      (chunk, idx, arr) => arr.findIndex((c) => c.id === chunk.id) === idx
    );
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
  // Claude sees the full conversation history + fresh RAG context each turn.
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

  // ── 6. Build RAG-augmented message ────────────────────────────────────────
  // Inject retrieved context into the final user turn only.
  // History messages are sent as-is — Claude uses them for memory.
  const augmentedQuestion = buildUserMessage(question, chunks, language);

  const chatMessages: ChatMessage[] = [...modelHistory, { role: "user", content: augmentedQuestion }];

  // ── 7. Stream with AI SDK v6 ──────────────────────────────────────────────
  const result = streamText({
    model: gateway(CHAT_MODEL),
    system: SYSTEM_PROMPT,
    messages: chatMessages,
    maxOutputTokens: 1500,
    stopWhen: stepCountIs(5),
    tools: createRagTools(language, chunks, addToolChunks),
    experimental_transform: smoothStream({
      delayInMs: 20,
      chunking: "word",
    }),

    onFinish: async ({ text, totalUsage, finishReason }) => {
      // Build details object for persistence
      const details: MessageDetails = {
        inputTokens: totalUsage.inputTokens ?? undefined,
        outputTokens: totalUsage.outputTokens ?? undefined,
        totalTokens: totalUsage.totalTokens ?? undefined,
        reasoningTokens: totalUsage.outputTokenDetails?.reasoningTokens ?? undefined,
        latencyMs: Date.now() - startTime,
        model: CHAT_MODEL,
        finishReason,
      };

      // Update cache with complete answer
      if (!cached && !hasFixedChunks) {
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
        };
        return { sources: getResponseSources(), details };
      }
      return undefined;
    },
  });
}
