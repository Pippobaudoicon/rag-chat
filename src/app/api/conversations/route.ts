import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { DEFAULT_SOURCES } from "@/lib/types";
import type { SourceType, Language } from "@/lib/types";

export const runtime = "nodejs";

// GET /api/conversations — list user's conversations, newest first
export async function GET() {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

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
    .where(eq(conversations.clerkUserId, userId))
    .orderBy(desc(conversations.updatedAt));

  return Response.json(list);
}

// POST /api/conversations — create a new conversation
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const language: Language = body.language ?? "ita";
  const sources: SourceType[] = body.sources ?? DEFAULT_SOURCES;

  const db = getDb();
  const [convo] = await db
    .insert(conversations)
    .values({ clerkUserId: userId, language, sources })
    .returning();

  return Response.json(convo, { status: 201 });
}
