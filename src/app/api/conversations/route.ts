import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import {
  conversations,
  messages,
  type Conversation,
} from "@/lib/db/schema";
import {
  badRequestFromZod,
  createConversationSchema,
  uuidSchema,
} from "@/lib/api/validation";
import {
  conversationListCacheKey,
  getConversationListFromCache,
  invalidateConversationCaches,
  setConversationListInCache,
} from "@/lib/rag/cache";
import { isChatGenerationStale } from "@/lib/chat/generation";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function encodeCursor(item: { id: string; updatedAt: Date }) {
  return `${item.updatedAt.toISOString()}_${item.id}`;
}

function parseCursor(value: string | null) {
  if (!value) return null;

  const separatorIndex = value.lastIndexOf("_");
  if (separatorIndex === -1) return null;

  const updatedAt = new Date(value.slice(0, separatorIndex));
  const id = value.slice(separatorIndex + 1);

  if (Number.isNaN(updatedAt.getTime()) || !uuidSchema.safeParse(id).success) {
    return null;
  }

  return { updatedAt, id };
}

// GET /api/conversations — list user's conversations, newest first
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const limit = clampLimit(req.nextUrl.searchParams.get("limit"));
  const cursor = parseCursor(req.nextUrl.searchParams.get("cursor"));
  const cacheKey = conversationListCacheKey(userId, limit, cursor ? encodeCursor(cursor) : null);
  const cached = await getConversationListFromCache(cacheKey);
  if (
    cached &&
    !cached.items.some((conversation) => conversation.generationStatus === "streaming")
  ) {
    return Response.json(cached, {
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const pageSize = limit + 1;

  const where = cursor
    ? and(
        eq(conversations.clerkUserId, userId),
        or(
          lt(conversations.updatedAt, cursor.updatedAt),
          and(
            eq(conversations.updatedAt, cursor.updatedAt),
            lt(conversations.id, cursor.id)
          )
        )
      )
    : eq(conversations.clerkUserId, userId);

  const db = getDb();
  const list = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      generationStatus: conversations.generationStatus,
      generationStartedAt: conversations.generationStartedAt,
      activeTurnId: conversations.activeTurnId,
      language: conversations.language,
      sources: conversations.sources,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(where)
    .orderBy(desc(conversations.updatedAt), desc(conversations.id))
    .limit(pageSize);

  const rawItems = list.slice(0, limit);
  const staleItems = rawItems
    .filter((conversation) =>
      isChatGenerationStale(
        conversation.generationStatus,
        conversation.generationStartedAt,
        Date.now(),
        conversation.activeTurnId === null
      )
    );

  const recoveryResults = await Promise.all(
    staleItems.map((snapshot) =>
      db
        .update(conversations)
        .set({
          generationStatus: "error",
          activeTurnId: null,
          activeStreamId: null,
          generationStartedAt: null,
        })
        .where(
          and(
            eq(conversations.id, snapshot.id),
            eq(conversations.clerkUserId, userId),
            eq(conversations.generationStatus, "streaming"),
            snapshot.activeTurnId === null
              ? isNull(conversations.activeTurnId)
              : eq(conversations.activeTurnId, snapshot.activeTurnId)
          )
        )
        .returning({ id: conversations.id })
    )
  );
  const recoveredIds = new Set(
    recoveryResults.flatMap((rows) => rows.map((row) => row.id))
  );

  if (recoveredIds.size > 0) {
    await invalidateConversationCaches(userId);
  }

  const items = rawItems.map(
    ({ generationStartedAt: _, activeTurnId: __, ...conversation }) => ({
      ...conversation,
      generationStatus: recoveredIds.has(conversation.id)
        ? ("error" as const)
        : conversation.generationStatus,
    })
  );
  const nextCursor =
    list.length > limit ? encodeCursor(rawItems[rawItems.length - 1]) : null;

  const payload = {
    items,
    nextCursor,
    hasMore: nextCursor !== null,
  };

  if (!items.some((conversation) => conversation.generationStatus === "streaming")) {
    void setConversationListInCache(cacheKey, payload);
  }

  return Response.json(
    payload,
    {
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}

// POST /api/conversations — create a new conversation
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const parsedBody = createConversationSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsedBody.success) {
    return badRequestFromZod(parsedBody.error);
  }

  const { language, sources, responseStyle, title, initialMessage } = parsedBody.data;

  const db = getDb();
  const conversationValues = {
    clerkUserId: userId,
    language,
    sources,
    responseStyle: responseStyle ?? null,
    title: title ?? null,
  };
  let convo: Conversation;
  let initialMessageId: number | undefined;

  if (initialMessage) {
    const conversationId = crypto.randomUUID();
    const generationStartedAt = new Date();
    const [createdConversations, createdMessages] = await db.batch([
      db
        .insert(conversations)
        .values({
          id: conversationId,
          ...conversationValues,
          // The durable user turn is immediately visible as pending work. The
          // chat route atomically replaces activeTurnId=null with its turn id.
          generationStatus: "streaming",
          generationStartedAt,
        })
        .returning(),
      db
        .insert(messages)
        .values({
          conversationId,
          role: "user",
          content: initialMessage,
        })
        .returning({ id: messages.id }),
    ]);
    convo = createdConversations[0];
    initialMessageId = createdMessages[0].id;
  } else {
    [convo] = await db
      .insert(conversations)
      .values(conversationValues)
      .returning();
  }

  void invalidateConversationCaches(userId);

  return Response.json({ ...convo, initialMessageId }, { status: 201 });
}
