import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { ChatInterface } from "@/components/chat/ChatInterface";
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
    metadata: msg.sourcesJson ? { sources: msg.sourcesJson } : undefined,
  }));

  return (
    <ChatInterface
      conversationId={convo.id}
      initialMessages={initialMessages}
    />
  );
}
