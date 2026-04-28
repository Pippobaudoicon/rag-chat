import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import {
  badRequestFromZod,
  createConversationSchema,
  uuidSchema,
} from "@/lib/api/validation";

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
      language: conversations.language,
      sources: conversations.sources,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(where)
    .orderBy(desc(conversations.updatedAt), desc(conversations.id))
    .limit(pageSize);

  const items = list.slice(0, limit);
  const nextCursor = list.length > limit ? encodeCursor(items[items.length - 1]) : null;

  return Response.json(
    {
      items,
      nextCursor,
      hasMore: nextCursor !== null,
    },
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

  const { language, sources } = parsedBody.data;

  const db = getDb();
  const [convo] = await db
    .insert(conversations)
    .values({ clerkUserId: userId, language, sources })
    .returning();

  return Response.json(convo, { status: 201 });
}
