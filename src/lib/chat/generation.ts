import type { ChatGenerationStatus } from "@/lib/types";

// The chat route has a 180 second execution limit. The extra minute prevents a
// crashed producer from leaving a conversation permanently stuck in streaming.
export const CHAT_GENERATION_STALE_AFTER_MS = 4 * 60 * 1000;
// A first turn is visible as streaming as soon as the conversation + user
// message are persisted, before /api/chat claims it with an activeTurnId. If
// that second request never reaches the server, recover the pending marker much
// sooner than a model generation that is already running.
export const CHAT_GENERATION_PENDING_STALE_AFTER_MS = 30 * 1000;

export function isChatGenerationActive(status: ChatGenerationStatus): boolean {
  return status === "streaming";
}

export function isChatGenerationStale(
  status: ChatGenerationStatus,
  startedAt: Date | string | null | undefined,
  now = Date.now(),
  pendingClaim = false
): boolean {
  if (!isChatGenerationActive(status) || !startedAt) return false;
  const startedAtMs = new Date(startedAt).getTime();
  const staleAfterMs = pendingClaim
    ? CHAT_GENERATION_PENDING_STALE_AFTER_MS
    : CHAT_GENERATION_STALE_AFTER_MS;
  return Number.isFinite(startedAtMs) && now - startedAtMs > staleAfterMs;
}

export function shouldResumeChatStream(
  status: ChatGenerationStatus,
  activeStreamId: string | null | undefined,
  resumeConfigured: boolean
): boolean {
  return resumeConfigured && isChatGenerationActive(status) && !!activeStreamId;
}

export function shouldCommitGeneration(
  activeTurnId: string | null | undefined,
  finishedTurnId: string
): boolean {
  return activeTurnId === finishedTurnId;
}

export function matchesChatGenerationSnapshot(
  status: ChatGenerationStatus,
  activeTurnId: string | null | undefined,
  expectedActiveTurnId: string | null | undefined
): boolean {
  return isChatGenerationActive(status) && activeTurnId === expectedActiveTurnId;
}

export function resolvePersistedUserTurn<
  TMessage extends { id: number; role: string; content: string },
>(
  storedMessages: TMessage[],
  persistedUserMessageId: number | undefined,
  question: string
): { currentMessage: TMessage | null; priorMessages: TMessage[] } {
  if (!persistedUserMessageId) {
    return { currentMessage: null, priorMessages: storedMessages };
  }

  // The persisted id is a one-turn handoff, not a reusable message reference.
  // Accept only the current tail user row; once an assistant is stored (or a
  // newer user row exists), replaying the old id is rejected.
  const tailMessage = storedMessages.at(-1);
  const currentMessage =
    tailMessage?.id === persistedUserMessageId &&
    tailMessage.role === "user" &&
    tailMessage.content === question
      ? tailMessage
      : null;

  return {
    currentMessage,
    priorMessages: currentMessage ? storedMessages.slice(0, -1) : storedMessages,
  };
}
