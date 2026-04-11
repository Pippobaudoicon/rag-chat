import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations, messageFeedback, messages } from "@/lib/db/schema";
import type { SourceChunk } from "@/lib/types";

export const runtime = "nodejs";

type FeedbackValue = "up" | "down";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const conversationId = Number(body.conversationId);
  const feedback = body.feedback as FeedbackValue;
  const clientMessageId =
    typeof body.clientMessageId === "string" && body.clientMessageId.trim().length > 0
      ? body.clientMessageId.trim().slice(0, 200)
      : null;
  const question =
    typeof body.question === "string" && body.question.trim().length > 0
      ? body.question.trim().slice(0, 2000)
      : null;
  const comment =
    typeof body.comment === "string" && body.comment.trim().length > 0
      ? body.comment.trim().slice(0, 2000)
      : null;
  const answerText =
    typeof body.answerText === "string" && body.answerText.trim().length > 0
      ? body.answerText.trim().slice(0, 12000)
      : null;
  const sources = Array.isArray(body.sources) ? (body.sources as SourceChunk[]) : null;

  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return new Response("Bad Request: invalid conversationId", { status: 400 });
  }

  if (feedback !== "up" && feedback !== "down") {
    return new Response("Bad Request: invalid feedback value", { status: 400 });
  }

  const db = getDb();

  const convo = await db.query.conversations.findFirst({
    where: and(eq(conversations.id, conversationId), eq(conversations.clerkUserId, userId)),
  });

  if (!convo) {
    return new Response("Conversation not found", { status: 404 });
  }

  let assistantMessageId: number | null = null;
  if (body.assistantMessageId != null && body.assistantMessageId !== "") {
    const numericMessageId = Number(body.assistantMessageId);
    if (!Number.isInteger(numericMessageId) || numericMessageId <= 0) {
      return new Response("Bad Request: invalid assistantMessageId", { status: 400 });
    }

    const assistantMessage = await db.query.messages.findFirst({
      where: and(
        eq(messages.id, numericMessageId),
        eq(messages.conversationId, conversationId),
        eq(messages.role, "assistant")
      ),
    });

    if (!assistantMessage) {
      return new Response("Bad Request: assistant message not found", { status: 400 });
    }

    assistantMessageId = numericMessageId;
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

  return Response.json({ ok: true });
}
