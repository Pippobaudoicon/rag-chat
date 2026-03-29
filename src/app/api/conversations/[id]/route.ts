import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

async function getOwnedConversation(id: number, userId: string) {
  const db = getDb();
  return (
    (await db.query.conversations.findFirst({
      where: and(
        eq(conversations.id, id),
        eq(conversations.clerkUserId, userId)
      ),
    })) ?? null
  );
}

// GET /api/conversations/[id] — full conversation with all messages
export async function GET(_: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const convo = await getOwnedConversation(Number(id), userId);
  if (!convo) return new Response("Not Found", { status: 404 });

  const db = getDb();
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convo.id))
    .orderBy(asc(messages.createdAt));

  return Response.json({ ...convo, messages: msgs });
}

// PATCH /api/conversations/[id] — rename conversation
export async function PATCH(req: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const title = body.title?.trim();
  if (!title) return new Response("Bad Request: title required", { status: 400 });

  const convo = await getOwnedConversation(Number(id), userId);
  if (!convo) return new Response("Not Found", { status: 404 });

  const db = getDb();
  const [updated] = await db
    .update(conversations)
    .set({ title: title.slice(0, 200), updatedAt: new Date() })
    .where(eq(conversations.id, convo.id))
    .returning();

  return Response.json(updated);
}

// DELETE /api/conversations/[id] — delete conversation + messages (cascade)
export async function DELETE(_: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const convo = await getOwnedConversation(Number(id), userId);
  if (!convo) return new Response("Not Found", { status: 404 });

  const db = getDb();
  await db.delete(conversations).where(eq(conversations.id, convo.id));
  return new Response(null, { status: 204 });
}
