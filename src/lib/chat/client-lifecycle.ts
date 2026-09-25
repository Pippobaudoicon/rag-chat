import type { AssistantVersion } from "@/lib/types";

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

export function shouldAutoFocusNewChatComposer(
  conversationId: string | undefined,
  initialMessageCount: number,
  onboardingPending: boolean
): boolean {
  return (
    conversationId === undefined &&
    initialMessageCount === 0 &&
    !onboardingPending
  );
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

export type ChatErrorKind = "quota" | "busy" | "network" | "generic";

/**
 * What a failed turn's error card says. HTTP errors carry the response body as
 * the message (e.g. the 429 JSON); stream errors arrive already masked, so they
 * fall through to "generic".
 */
export function chatErrorKind(error: Error | undefined, online: boolean): ChatErrorKind {
  const errorText = error?.message ?? "";
  if (/rate limit/i.test(errorText)) return "quota";
  if (/already being generated/i.test(errorText)) return "busy";
  if (error && (!online || /failed to fetch|network/i.test(errorText))) return "network";
  return "generic";
}

/**
 * Stored versions for each assistant message, matched by position (the Nth
 * assistant message gets the Nth stored list). Covers assistant messages whose
 * client id differs from the stored row id, e.g. after a resumed stream.
 * Messages without stored versions are left out.
 */
export function assistantVersionsByPosition(
  messages: readonly { id: string; role: string }[],
  storedAssistantVersions: readonly AssistantVersion[][]
): Record<string, AssistantVersion[]> {
  const versionsById: Record<string, AssistantVersion[]> = {};
  let assistantIndex = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const versions = storedAssistantVersions[assistantIndex] ?? [];
    if (versions.length > 0) versionsById[message.id] = versions;
    assistantIndex += 1;
  }
  return versionsById;
}

/**
 * Versions after a regeneration: the new answer is appended to the known
 * versions, or follows the answer it replaced when none were known.
 */
export function withRegeneratedVersion(
  existing: AssistantVersion[] | undefined,
  previousVersion: AssistantVersion,
  newVersion: AssistantVersion
): AssistantVersion[] {
  return existing && existing.length > 0
    ? [...existing, newVersion]
    : [previousVersion, newVersion];
}
