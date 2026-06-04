import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import {
  badRequestFromZod,
  updateConversationSchema,
  uuidSchema,
} from "@/lib/api/validation";
import {
  getConversationTitleFromCache,
  setConversationTitleInCache,
  conversationTitleCacheKey,
  invalidateConversationCaches,
  invalidateConversationTitleCache,
} from "@/lib/rag/cache";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

async function getOwnedConversation(id: string, userId: string) {
  if (!uuidSchema.safeParse(id).success) return null;

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
  const convo = await getOwnedConversation(id, userId);
  if (!convo) return new Response("Not Found", { status: 404 });

  const titleCacheKey = conversationTitleCacheKey(userId, convo.id);
  const cachedTitle = await getConversationTitleFromCache(titleCacheKey);
  const conversationWithCachedTitle =
    cachedTitle === undefined ? convo : { ...convo, title: cachedTitle };

  const db = getDb();
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convo.id))
    .orderBy(asc(messages.createdAt));

  if (cachedTitle === undefined) {
    void setConversationTitleInCache(titleCacheKey, convo.title);
  }

  return Response.json({ ...conversationWithCachedTitle, messages: msgs });
}

// PATCH /api/conversations/[id] — rename and/or change the response-style
// override.
export async function PATCH(req: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const parsed = updateConversationSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) return badRequestFromZod(parsed.error);

  const convo = await getOwnedConversation(id, userId);
  if (!convo) return new Response("Not Found", { status: 404 });

  const { title, responseStyle } = parsed.data;
  const patch: { title?: string; responseStyle?: string; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (title !== undefined) patch.title = title.slice(0, 200);
  if (responseStyle !== undefined) patch.responseStyle = responseStyle;

  const db = getDb();
  const [updated] = await db
    .update(conversations)
    .set(patch)
    .where(eq(conversations.id, convo.id))
    .returning();

  const invalidations: Promise<unknown>[] = [invalidateConversationCaches(userId)];
  if (title !== undefined) {
    invalidations.push(
      setConversationTitleInCache(
        conversationTitleCacheKey(userId, convo.id),
        updated.title
      )
    );
  }
  void Promise.all(invalidations);

  return Response.json(updated);
}

// DELETE /api/conversations/[id] — delete conversation + messages (cascade)
export async function DELETE(_: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const convo = await getOwnedConversation(id, userId);
  if (!convo) return new Response("Not Found", { status: 404 });

  const db = getDb();
  await db.delete(conversations).where(eq(conversations.id, convo.id));

  void Promise.all([
    invalidateConversationTitleCache(userId, convo.id),
    invalidateConversationCaches(userId),
  ]);

  return new Response(null, { status: 204 });
}
