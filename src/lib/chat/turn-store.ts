import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations, type Conversation } from "@/lib/db/schema";
import { invalidateConversationCaches } from "@/lib/rag/cache";

// Conversation generation-state writes made by POST /api/chat. The pure rules
// (active/stale/ownership) live in `generation.ts`.

const ownedConversation = (conversationId: string, userId: string) =>
  and(eq(conversations.id, conversationId), eq(conversations.clerkUserId, userId));

/**
 * The conversation row while `turnId` still owns its generation. Every write a
 * turn makes after its claim is filtered by this, so a turn that lost the claim
 * (or was recovered as stale) changes nothing.
 */
export function ownedActiveTurn(conversationId: string, userId: string, turnId: string) {
  return and(
    ownedConversation(conversationId, userId),
    eq(conversations.generationStatus, "streaming"),
    eq(conversations.activeTurnId, turnId)
  );
}

/**
 * POST /api/conversations exposes the first turn immediately as an active
 * pending generation (streaming + no activeTurnId). If an early gate rejects
 * /api/chat before it can claim that turn, clear only that pending snapshot;
 * never touch a request that already has a server-owned activeTurnId.
 */
export async function releasePendingInitialTurn(
  conversationId: string | null | undefined,
  persistedUserMessageId: number | null | undefined,
  userId: string
): Promise<void> {
  if (!conversationId || !persistedUserMessageId) return;
  try {
    const [released] = await getDb()
      .update(conversations)
      .set({
        generationStatus: "error",
        generationStartedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          ownedConversation(conversationId, userId),
          eq(conversations.generationStatus, "streaming"),
          isNull(conversations.activeTurnId)
        )
      )
      .returning({ id: conversations.id });
    if (released) await invalidateConversationCaches(userId);
  } catch (error) {
    console.error("Failed to release pending initial chat turn", error);
  }
}

/**
 * Moves a stale `streaming` row (same turn as in `conversation`) to `error`,
 * and updates `conversation` to match when the write lands.
 */
export async function recoverStaleGeneration(
  conversation: Conversation,
  userId: string
): Promise<void> {
  const staleTurnId = conversation.activeTurnId;
  const [recoveredConversation] = await getDb()
    .update(conversations)
    .set({
      generationStatus: "error",
      activeTurnId: null,
      activeStreamId: null,
      generationStartedAt: null,
    })
    .where(
      and(
        ownedConversation(conversation.id, userId),
        eq(conversations.generationStatus, "streaming"),
        staleTurnId === null
          ? isNull(conversations.activeTurnId)
          : eq(conversations.activeTurnId, staleTurnId)
      )
    )
    .returning({ id: conversations.id });
  if (recoveredConversation) {
    conversation.generationStatus = "error";
    conversation.activeTurnId = null;
    conversation.activeStreamId = null;
    conversation.generationStartedAt = null;
  }
}

/**
 * Atomic compare-and-set: a pending first turn (streaming + null activeTurnId)
 * or any non-streaming row becomes owned by `turnId`. Returns false when
 * another request holds the generation.
 */
export async function claimGeneration({
  conversationId,
  userId,
  turnId,
  activeStreamId,
  fromPendingInitialTurn,
}: {
  conversationId: string;
  userId: string;
  turnId: string;
  activeStreamId: string | null;
  fromPendingInitialTurn: boolean;
}): Promise<boolean> {
  const [claimedConversation] = await getDb()
    .update(conversations)
    .set({
      generationStatus: "streaming",
      activeTurnId: turnId,
      activeStreamId,
      generationStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        ownedConversation(conversationId, userId),
        fromPendingInitialTurn
          ? and(
              eq(conversations.generationStatus, "streaming"),
              isNull(conversations.activeTurnId)
            )
          : ne(conversations.generationStatus, "streaming")
      )
    )
    .returning({ id: conversations.id });
  return !!claimedConversation;
}

/** Marks the turn's generation as `error`. Never throws. */
export async function markGenerationError(
  conversationId: string,
  userId: string,
  turnId: string
): Promise<void> {
  try {
    const [markedConversation] = await getDb()
      .update(conversations)
      .set({
        generationStatus: "error",
        activeTurnId: null,
        activeStreamId: null,
        generationStartedAt: null,
        updatedAt: new Date(),
      })
      .where(ownedActiveTurn(conversationId, userId, turnId))
      .returning({ id: conversations.id });
    if (markedConversation) {
      await invalidateConversationCaches(userId);
    }
  } catch (markError) {
    console.error("Failed to persist chat generation error state", markError);
  }
}

/** The `complete` update for the turn, to run in a batch with its message write. */
export function completeGenerationUpdate(
  conversationId: string,
  userId: string,
  turnId: string
) {
  return getDb()
    .update(conversations)
    .set({
      generationStatus: "complete",
      activeTurnId: null,
      activeStreamId: null,
      generationStartedAt: null,
      updatedAt: new Date(),
    })
    .where(ownedActiveTurn(conversationId, userId, turnId));
}
