import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations, messageFeedback, messages } from "@/lib/db/schema";
import { ChatInterface } from "@/components/chat/ChatInterface";
import type { AssistantVersion } from "@/lib/types";
import type { UIMessage } from "ai";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ConversationPage({ params }: Props) {
  const { id } = await params;
  const { userId } = await auth();

  if (!userId) notFound();

  const db = getDb();
  const convo = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, Number(id)),
      eq(conversations.clerkUserId, userId)
    ),
  });

  if (!convo) notFound();

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convo.id))
    .orderBy(asc(messages.createdAt));

  // Map DB messages to UIMessage format for AI SDK useChat initialMessages
  // Include sources for assistant messages so they can be displayed in the UI
  const initialMessages: UIMessage[] = msgs.map((msg) => ({
    id: String(msg.id),
    role: msg.role as "user" | "assistant",
    content: msg.content,
    parts: [{ type: "text" as const, text: msg.content }],
    createdAt: msg.createdAt,
    metadata:
      msg.sourcesJson || msg.versionsJson || msg.detailsJson
        ? {
            sources: msg.sourcesJson ?? undefined,
            versions: msg.versionsJson ?? undefined,
            details: msg.detailsJson ?? undefined,
          }
        : undefined,
  }));

  const initialMessageVersions: Record<string, AssistantVersion[]> = Object.fromEntries(
    msgs
      .filter((msg) => msg.role === "assistant" && !!msg.versionsJson && msg.versionsJson.length > 0)
      .map((msg) => [String(msg.id), msg.versionsJson as AssistantVersion[]])
  );

  const initialAssistantVersions: AssistantVersion[][] = msgs
    .filter((msg) => msg.role === "assistant")
    .map((msg) => (msg.versionsJson as AssistantVersion[] | null) ?? []);

  const feedbackRows = await db
    .select({
      assistantMessageId: messageFeedback.assistantMessageId,
      feedback: messageFeedback.feedback,
      comment: messageFeedback.comment,
      createdAt: messageFeedback.createdAt,
    })
    .from(messageFeedback)
    .where(
      and(
        eq(messageFeedback.conversationId, convo.id),
        eq(messageFeedback.clerkUserId, userId)
      )
    )
    .orderBy(asc(messageFeedback.createdAt));

  const initialFeedbackByMessageId: Record<string, { value: "up" | "down"; comment: string | null }> = {};
  for (const row of feedbackRows) {
    if (!row.assistantMessageId) continue;
    if (row.feedback !== "up" && row.feedback !== "down") continue;
    initialFeedbackByMessageId[String(row.assistantMessageId)] = {
      value: row.feedback,
      comment: row.comment ?? null,
    };
  }

  return (
    <ChatInterface
      conversationId={convo.id}
      initialMessages={initialMessages}
      initialMessageVersions={initialMessageVersions}
      initialAssistantVersions={initialAssistantVersions}
      initialFeedbackByMessageId={initialFeedbackByMessageId}
    />
  );
}
