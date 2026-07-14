export const CHAT_GENERATION_CLAIM_TIMEOUT_MS = 30_000;
export const CHAT_GENERATION_TRANSPORT_ERROR_GRACE_MS = 5_000;

export function isGenerationClaimTimedOut(
  startedAt: number | null,
  now = Date.now()
): boolean {
  return startedAt !== null && now - startedAt >= CHAT_GENERATION_CLAIM_TIMEOUT_MS;
}

export function shouldFailGenerationClaim(
  startedAt: number | null,
  transportError: boolean,
  now = Date.now()
): boolean {
  if (isGenerationClaimTimedOut(startedAt, now)) return true;
  return (
    transportError &&
    startedAt !== null &&
    now - startedAt >= CHAT_GENERATION_TRANSPORT_ERROR_GRACE_MS
  );
}

export function shouldShowPendingAssistant(
  messages: readonly { role: string }[],
  isStreaming: boolean
): boolean {
  if (!isStreaming) return false;
  const lastMessage = messages.at(-1);
  return !lastMessage || lastMessage.role === "user";
}

export function mergeRefreshedConversationFirstPage<T extends { id: string }>(
  existing: readonly T[],
  refreshedFirstPage: readonly T[],
  pageSize: number
): T[] {
  if (existing.length <= pageSize) return [...refreshedFirstPage];

  const refreshedIds = new Set(refreshedFirstPage.map((conversation) => conversation.id));
  return [
    ...refreshedFirstPage,
    ...existing.filter((conversation) => !refreshedIds.has(conversation.id)),
  ];
}
