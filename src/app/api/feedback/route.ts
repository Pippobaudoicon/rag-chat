import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations, messageFeedback, messages } from "@/lib/db/schema";
import { badRequestFromZod, feedbackRequestSchema } from "@/lib/api/validation";
import { recordFeedbackMemory } from "@/lib/memory/conversation-memory";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const parsedBody = feedbackRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsedBody.success) {
    return badRequestFromZod(parsedBody.error);
  }

  const {
    conversationId,
    assistantMessageId: rawAssistantMessageId,
    clientMessageId = null,
    feedback,
    comment = null,
    question = null,
    answerText = null,
    sources = null,
  } = parsedBody.data;

  const db = getDb();

  const convo = await db.query.conversations.findFirst({
    where: and(eq(conversations.id, conversationId), eq(conversations.clerkUserId, userId)),
  });

  if (!convo) {
    return new Response("Conversation not found", { status: 404 });
  }

  let assistantMessageId: number | null = null;
  if (rawAssistantMessageId != null) {
    const assistantMessage = await db.query.messages.findFirst({
      where: and(
        eq(messages.id, rawAssistantMessageId),
        eq(messages.conversationId, conversationId),
        eq(messages.role, "assistant")
      ),
    });

    if (!assistantMessage) {
      return new Response("Bad Request: assistant message not found", { status: 400 });
    }

    assistantMessageId = rawAssistantMessageId;
  }

  if (assistantMessageId) {
    const existing = await db.query.messageFeedback.findFirst({
      where: and(
        eq(messageFeedback.conversationId, conversationId),
        eq(messageFeedback.clerkUserId, userId),
        eq(messageFeedback.assistantMessageId, assistantMessageId)
      ),
      orderBy: [desc(messageFeedback.createdAt)],
    });

    if (existing) {
      await db
        .update(messageFeedback)
        .set({
          clientMessageId,
          feedback,
          comment,
          question,
          answerText,
          sourcesJson: sources,
          createdAt: new Date(),
        })
        .where(eq(messageFeedback.id, existing.id));

      await recordFeedbackMemory({
        clerkUserId: userId,
        feedback,
        comment,
        question,
        answerText,
      });

      return Response.json({ ok: true });
    }
  }

  await db.insert(messageFeedback).values({
    conversationId,
    assistantMessageId,
    clerkUserId: userId,
    clientMessageId,
    feedback,
    comment,
    question,
    answerText,
    sourcesJson: sources,
  });

  await recordFeedbackMemory({
    clerkUserId: userId,
    feedback,
    comment,
    question,
    answerText,
  });

  return Response.json({ ok: true });
}
