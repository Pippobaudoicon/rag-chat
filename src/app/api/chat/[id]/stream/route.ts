import { auth } from "@clerk/nextjs/server";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { uuidSchema } from "@/lib/api/validation";
import {
  isChatGenerationStale,
  shouldResumeChatStream,
} from "@/lib/chat/generation";
import {
  getChatStreamContext,
  isChatStreamResumeConfigured,
} from "@/lib/chat/resumable-stream";
import { invalidateConversationCaches } from "@/lib/rag/cache";

export const runtime = "nodejs";
export const maxDuration = 180;

type Params = { params: Promise<{ id: string }> };

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function GET(_: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return new Response("Not Found", { status: 404 });
  }

  const db = getDb();
  let conversation = await db.query.conversations.findFirst({
    columns: {
      id: true,
      generationStatus: true,
      generationStartedAt: true,
      activeTurnId: true,
      activeStreamId: true,
    },
    where: and(
      eq(conversations.id, id),
      eq(conversations.clerkUserId, userId)
    ),
  });

  if (!conversation) return new Response("Not Found", { status: 404 });

  if (
    isChatGenerationStale(
      conversation.generationStatus,
      conversation.generationStartedAt,
      Date.now(),
      conversation.activeTurnId === null
    )
  ) {
    const staleTurnId = conversation.activeTurnId;
    const [recoveredConversation] = await db
      .update(conversations)
      .set({
        generationStatus: "error",
        activeTurnId: null,
        activeStreamId: null,
        generationStartedAt: null,
      })
      .where(
        and(
          eq(conversations.id, conversation.id),
          eq(conversations.clerkUserId, userId),
          eq(conversations.generationStatus, "streaming"),
          staleTurnId === null
            ? isNull(conversations.activeTurnId)
            : eq(conversations.activeTurnId, staleTurnId)
        )
      )
      .returning({ id: conversations.id });
    if (recoveredConversation) {
      await invalidateConversationCaches(userId);
      return new Response(null, { status: 204 });
    }

    conversation = await db.query.conversations.findFirst({
      columns: {
        id: true,
        generationStatus: true,
        generationStartedAt: true,
        activeTurnId: true,
        activeStreamId: true,
      },
      where: and(
        eq(conversations.id, id),
        eq(conversations.clerkUserId, userId)
      ),
    });
    if (!conversation) return new Response("Not Found", { status: 404 });
  }

  if (
    !shouldResumeChatStream(
      conversation.generationStatus,
      conversation.activeStreamId,
      isChatStreamResumeConfigured()
    )
  ) {
    return new Response(null, { status: 204 });
  }

  const streamContext = getChatStreamContext();
  if (!streamContext || !conversation.activeStreamId) {
    return new Response(null, { status: 204 });
  }

  // The POST stores activeStreamId immediately before registering the producer.
  // A returning browser can land in that narrow window, so give setup a short
  // chance to finish instead of turning the only resume attempt into a false 204.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const stream = await streamContext.resumeExistingStream(
        conversation.activeStreamId
      );
      if (stream) {
        return new Response(stream.pipeThrough(new TextEncoderStream()), {
          headers: UI_MESSAGE_STREAM_HEADERS,
        });
      }
      if (stream === null) return new Response(null, { status: 204 });
    } catch (error) {
      if (attempt === 3) {
        console.error("Failed to resume chat stream", error);
        return new Response(null, { status: 204 });
      }
    }
    await wait(150);
  }

  return new Response(null, { status: 204 });
}
