import { getViewer } from "@/lib/auth/guest";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { uuidSchema } from "@/lib/api/validation";
import { generateFollowUps } from "@/lib/chat/follow-ups";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// POST /api/conversations/[id]/follow-ups — suggested next questions for the
// conversation's latest answer. Generated once per answer and stored in its
// details (`followUps`), so repeat calls return the stored list without a model
// call; the model cost is therefore bounded by the chat quota.
export async function POST(_req: Request, { params }: Params) {
  const { userId } = await getViewer();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return new Response("Not Found", { status: 404 });

  const db = getDb();
  const convo = await db.query.conversations.findFirst({
    columns: { id: true, generationStatus: true },
    where: and(eq(conversations.id, id), eq(conversations.clerkUserId, userId)),
  });
  if (!convo) return new Response("Not Found", { status: 404 });
  if (convo.generationStatus === "streaming") {
    return new Response("A response is still being generated", { status: 409 });
  }

  const [answer, question] = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      detailsJson: messages.detailsJson,
    })
    .from(messages)
    .where(eq(messages.conversationId, convo.id))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(2);

  if (answer?.role !== "assistant" || question?.role !== "user" || !answer.content.trim()) {
    return Response.json({ messageId: answer?.id ?? null, followUps: [] });
  }

  const stored = answer.detailsJson?.followUps;
  if (Array.isArray(stored)) {
    return Response.json({ messageId: answer.id, followUps: stored });
  }

  const followUps = await generateFollowUps(question.content, answer.content);
  if (followUps.length > 0) {
    // Merge into the stored details; skip if the answer was regenerated meanwhile.
    await db
      .update(messages)
      .set({
        detailsJson: sql`coalesce(${messages.detailsJson}, '{}'::jsonb) || ${JSON.stringify({ followUps })}::jsonb`,
      })
      .where(and(eq(messages.id, answer.id), eq(messages.content, answer.content)));
  }

  return Response.json({ messageId: answer.id, followUps });
}
