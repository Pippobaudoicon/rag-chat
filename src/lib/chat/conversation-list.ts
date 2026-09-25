import type { ChatGenerationStatus } from "@/lib/types";

// Pure rules for the sidebar conversation list. Tested by `test:chat-lifecycle`.

export interface ConversationItem {
  id: string;
  title: string | null;
  generationStatus?: ChatGenerationStatus;
  updatedAt: string;
}

/** Detail of the `chat:conversation-updated` window event. */
export interface ConversationUpdatedDetail {
  id: string;
  title?: string | null;
  generationStatus?: ChatGenerationStatus;
  updatedAt?: string;
}

export interface ConversationGroup {
  key: string;
  label: string;
  items: ConversationItem[];
}

/** Appends the next page, skipping conversations already listed. */
export function mergeConversationPages(
  existing: ConversationItem[],
  incoming: ConversationItem[]
) {
  const seen = new Set<string>();
  const merged: ConversationItem[] = [];

  for (const conversation of [...existing, ...incoming]) {
    if (seen.has(conversation.id)) continue;
    seen.add(conversation.id);
    merged.push(conversation);
  }

  return merged;
}

/**
 * Applies an update to its conversation, or adds it on top when it is new.
 * An update to an existing conversation re-sorts the list by `updatedAt`.
 */
export function upsertConversationItem(
  conversations: ConversationItem[],
  update: ConversationUpdatedDetail
) {
  const updatedAt = update.updatedAt ?? new Date().toISOString();
  const existing = conversations.find((conversation) => conversation.id === update.id);

  if (!existing) {
    return [
      {
        id: update.id,
        title: update.title ?? null,
        generationStatus: update.generationStatus,
        updatedAt,
      },
      ...conversations,
    ];
  }

  const merged = conversations.map((conversation) =>
    conversation.id === update.id
      ? {
          ...conversation,
          title: update.title === undefined ? conversation.title : update.title,
          generationStatus:
            update.generationStatus === undefined
              ? conversation.generationStatus
              : update.generationStatus,
          updatedAt,
        }
      : conversation
  );

  return merged.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/** Today / this week / this month / older, dropping empty groups. */
export function groupConversationsByAge(
  conversations: ConversationItem[],
  labels: { today: string; thisWeek: string; thisMonth: string; older: string },
  now = Date.now()
): ConversationGroup[] {
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

  const today: ConversationItem[] = [];
  const thisWeek: ConversationItem[] = [];
  const thisMonth: ConversationItem[] = [];
  const older: ConversationItem[] = [];

  for (const conversation of conversations) {
    const updatedAt = new Date(conversation.updatedAt).getTime();

    if (updatedAt > oneDayAgo) {
      today.push(conversation);
    } else if (updatedAt > oneWeekAgo) {
      thisWeek.push(conversation);
    } else if (updatedAt > oneMonthAgo) {
      thisMonth.push(conversation);
    } else {
      older.push(conversation);
    }
  }

  return [
    { key: "today", label: labels.today, items: today },
    { key: "this-week", label: labels.thisWeek, items: thisWeek },
    { key: "this-month", label: labels.thisMonth, items: thisMonth },
    { key: "older", label: labels.older, items: older },
  ].filter((group) => group.items.length > 0);
}
