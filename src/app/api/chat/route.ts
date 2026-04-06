import { auth } from "@clerk/nextjs/server";
import { streamText, generateId, gateway } from "ai";
import { eq, and, asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { retrieve } from "@/lib/rag/retriever";
import { SYSTEM_PROMPT, buildUserMessage } from "@/lib/rag/system-prompt";
import { cacheKey, getFromCache, setInCache } from "@/lib/rag/cache";
import { createRagTools } from "@/lib/rag/tools";
import { DEFAULT_SOURCES } from "@/lib/types";
import type { SourceType, Language, SourceChunk } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  const body = await req.json();
  const {
    messages: uiMessages = [],
    conversationId,
    language = "ita" as Language,
    sources = DEFAULT_SOURCES as SourceType[],
    topK = 20,
  } = body;

  // Extract the latest user question from UIMessage parts (AI SDK v6 format)
  const lastMessage = uiMessages.at(-1);
  const question: string =
    lastMessage?.parts?.find((p: { type: string }) => p.type === "text")?.text ??
    lastMessage?.content ??
    "";

  if (!question.trim()) {
    return new Response("Bad Request: empty question", { status: 400 });
  }

  // ── 3. Cache check ────────────────────────────────────────────────────────
  const key = cacheKey(question, language, sources, topK);
  const cached = await getFromCache(key);
  const chunks: SourceChunk[] = cached?.chunks ?? await retrieve(question, sources, language, topK);

  // ── 4. Conversation ownership ─────────────────────────────────────────────
  const db = getDb();
  let conversation = null;

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
  }

  // ── 5. Load conversation history for multi-turn memory ────────────────────
  // This is the key improvement over the Python single-turn RAG:
  // Claude sees the full conversation history + fresh RAG context each turn.
  type ChatMessage = { role: "user" | "assistant"; content: string };
  let history: ChatMessage[] = [];
  if (conversation) {
    const pastMessages = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(asc(messages.createdAt))
      // Last 20 messages to stay within context window
      .limit(20);
    history = pastMessages as ChatMessage[];

    // Persist the new user message immediately (before streaming starts)
    await db.insert(messages).values({
      conversationId: conversation.id,
      role: "user",
      content: question,
    });
  }

  // ── 6. Build RAG-augmented message ────────────────────────────────────────
  // Inject retrieved context into the final user turn only.
  // History messages are sent as-is — Claude uses them for memory.
  const augmentedQuestion = buildUserMessage(question, chunks, language);

  const chatMessages: ChatMessage[] = [
    ...history.slice(0, -1), // all history except the last user message
    { role: "user", content: augmentedQuestion }, // last turn with RAG context
  ];

  // ── 7. Stream with AI SDK v6 ──────────────────────────────────────────────
  const result = streamText({
    model: gateway("openai/gpt-4o-mini"),
    system: SYSTEM_PROMPT,
    messages: chatMessages,
    maxOutputTokens: 1500,
    tools: createRagTools(language, chunks),

    onFinish: async ({ text }) => {
      // Update cache with complete answer
      if (!cached) {
        await setInCache(key, { chunks, answer: text });
      }

      // Persist assistant response + update conversation metadata
      if (conversation) {
        await db.insert(messages).values({
          conversationId: conversation.id,
          role: "assistant",
          content: text,
          sourcesJson: chunks,
        });

        // Auto-title from first question (≤60 chars, break at word boundary)
        if (!conversation.title) {
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
    messageMetadata: ({ part }) => part.type === "finish" ? { sources: chunks } : undefined,
  });
}
