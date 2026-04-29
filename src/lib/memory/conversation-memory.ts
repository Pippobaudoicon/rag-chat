import { generateObject, gateway, tool } from "ai";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  conversations,
  conversationMemories,
  messages,
  userMemoryPeriods,
  userMemoryProfiles,
} from "@/lib/db/schema";

type MemoryCadence = "weekly" | "monthly";
type ConversationRefreshStatus = "updated" | "skipped" | "empty" | "failed";

interface RecordPersonalMemoryInput {
  clerkUserId: string;
  summary: string;
  preferences?: string[];
  facts?: string[];
  feedbackPatterns?: string[];
  occurredAt?: Date;
}

interface RecordFeedbackMemoryInput {
  clerkUserId: string;
  feedback: "up" | "down";
  comment: string | null;
  question: string | null;
  answerText: string | null;
}

const DEFAULT_MEMORY_MODEL = "deepseek/deepseek-v4-flash";
const MEMORY_MODEL = process.env.MEMORY_MODEL ?? process.env.CHAT_MODEL ?? DEFAULT_MEMORY_MODEL;
const MEMORY_ENABLED = process.env.CHAT_MEMORY_ENABLED !== "false";
const MEMORY_PERIOD_REFRESH_HOURS = getPositiveInt(
  process.env.CHAT_MEMORY_PERIOD_REFRESH_HOURS,
  24
);
const MAX_MEMORY_CONTEXT_CHARS = getPositiveInt(
  process.env.CHAT_MEMORY_CONTEXT_CHARS,
  3500
);
const MAX_SUMMARY_INPUT_CHARS = 8000;
const MANUAL_REFRESH_CONVERSATION_LIMIT = getPositiveInt(
  process.env.CHAT_MEMORY_MANUAL_CONVERSATION_LIMIT,
  20
);
const MANUAL_REFRESH_MESSAGE_LIMIT = getPositiveInt(
  process.env.CHAT_MEMORY_MANUAL_MESSAGE_LIMIT,
  40
);
const CRON_REFRESH_USER_LIMIT = getPositiveInt(
  process.env.CHAT_MEMORY_CRON_USER_LIMIT,
  2
);
const CRON_REFRESH_CONVERSATION_LIMIT = getPositiveInt(
  process.env.CHAT_MEMORY_CRON_CONVERSATION_LIMIT,
  2
);

const periodSummarySchema = z.object({
  summary: z.string().max(1800).default(""),
});

const feedbackMemorySchema = z.object({
  profileSummary: z.string().max(1400).default(""),
  preferences: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
  feedbackPatterns: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
});

const conversationMemorySchema = z.object({
  summary: z.string().max(1500).default(""),
  topics: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  preferences: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
  facts: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
  feedbackPatterns: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
});

function getPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function compactItems(items: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const compacted: string[] = [];

  for (const item of items) {
    const trimmed = item.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    compacted.push(trimmed);
    if (compacted.length >= maxItems) break;
  }

  return compacted;
}

function getPeriodBounds(now: Date, cadence: MemoryCadence) {
  if (cadence === "monthly") {
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { periodStart, periodEnd };
  }

  const periodStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ));
  const mondayOffset = (periodStart.getUTCDay() + 6) % 7;
  periodStart.setUTCDate(periodStart.getUTCDate() - mondayOffset);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 7);
  return { periodStart, periodEnd };
}

function shouldRefreshPeriod(refreshedAt: Date | null): boolean {
  if (!refreshedAt) return true;
  return Date.now() - refreshedAt.getTime() > MEMORY_PERIOD_REFRESH_HOURS * 60 * 60 * 1000;
}

function mergeSummary(existing: string | null | undefined, incoming: string, maxLength: number): string {
  const cleanIncoming = incoming.trim().replace(/\s+/g, " ");
  if (!cleanIncoming) return existing ?? "";
  if (!existing) return truncate(cleanIncoming, maxLength);
  if (existing.toLocaleLowerCase().includes(cleanIncoming.toLocaleLowerCase())) {
    return truncate(existing, maxLength);
  }

  return truncate(`${cleanIncoming}\n${existing}`, maxLength);
}

async function loadProfile(clerkUserId: string) {
  const db = getDb();
  return db.query.userMemoryProfiles.findFirst({
    where: eq(userMemoryProfiles.clerkUserId, clerkUserId),
  });
}

async function loadConversationMemoryInput({
  clerkUserId,
  limit,
  periodStart,
  periodEnd,
}: {
  clerkUserId: string;
  limit: number;
  periodStart?: Date;
  periodEnd?: Date;
}) {
  const db = getDb();
  const where = periodStart && periodEnd
    ? and(
        eq(conversations.clerkUserId, clerkUserId),
        gte(conversations.updatedAt, periodStart),
        lt(conversations.updatedAt, periodEnd)
      )
    : eq(conversations.clerkUserId, clerkUserId);

  const recentConversations = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      language: conversations.language,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(where)
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);

  const messagesPerConversation = await Promise.all(
    recentConversations.map((conversation) =>
      db
        .select({ role: messages.role, content: messages.content, createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(desc(messages.createdAt))
        .limit(MANUAL_REFRESH_MESSAGE_LIMIT)
    )
  );

  const sections: string[] = [];
  let messagesIncluded = 0;

  for (let index = 0; index < recentConversations.length; index += 1) {
    const conversation = recentConversations[index];
    const storedMessages = messagesPerConversation[index];
    if (storedMessages.length === 0) continue;

    const orderedMessages = storedMessages.reverse();
    messagesIncluded += orderedMessages.length;
    sections.push([
      `Conversation: ${conversation.title || "Untitled conversation"}`,
      `Language: ${conversation.language}`,
      `Updated: ${conversation.updatedAt.toISOString()}`,
      formatMessagesForMemory(orderedMessages),
    ].join("\n"));
  }

  return {
    conversations: recentConversations,
    conversationIds: recentConversations.map((conversation) => conversation.id),
    latestConversationAt: recentConversations[0]?.updatedAt ?? null,
    messagesIncluded,
    sections,
  };
}

async function refreshPeriodSummary(
  clerkUserId: string,
  cadence: MemoryCadence,
  now: Date,
  options: { force?: boolean } = {}
) {
  if (!MEMORY_ENABLED) return false;

  const db = getDb();
  const { periodStart, periodEnd } = getPeriodBounds(now, cadence);
  const existing = await db.query.userMemoryPeriods.findFirst({
    where: and(
      eq(userMemoryPeriods.clerkUserId, clerkUserId),
      eq(userMemoryPeriods.cadence, cadence)
    ),
  });

  if (existing?.summary && !options.force && !shouldRefreshPeriod(existing.refreshedAt)) {
    return false;
  }

  const input = await loadConversationMemoryInput({
    clerkUserId,
    limit: 50,
    periodStart,
    periodEnd,
  });

  if (input.sections.length === 0) return false;

  const prompt = [
    `Update the ongoing ${cadence} memory rollup for a personal LDS RAG assistant.`,
    "Preserve useful durable information from the existing rollup, add new recurring interests and preferences, and remove stale details when contradicted.",
    "Do not include private speculation. Do not quote full source text. Keep it useful for future personalization.",
    `Period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`,
    "Existing rollup:",
    existing?.summary || "(none)",
    "Recent conversations in this period:",
    input.sections.join("\n\n---\n\n"),
  ].join("\n\n");

  let object: z.infer<typeof periodSummarySchema>;
  try {
    const result = await generateObject({
      model: gateway(MEMORY_MODEL),
      schema: periodSummarySchema,
      system: "You write concise durable memory summaries for personalization. Return only fields matching the schema.",
      prompt: truncate(prompt, MAX_SUMMARY_INPUT_CHARS),
    });
    object = result.object;
  } catch (error) {
    console.error("Failed to refresh memory period summary", {
      clerkUserId,
      cadence,
      error,
    });
    return false;
  }

  await db
    .insert(userMemoryPeriods)
    .values({
      clerkUserId,
      cadence,
      periodStart,
      periodEnd,
      summary: object.summary,
      conversationRefsJson: input.conversationIds,
      refreshedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        userMemoryPeriods.clerkUserId,
        userMemoryPeriods.cadence,
      ],
      set: {
        periodStart,
        periodEnd,
        summary: object.summary,
        conversationRefsJson: input.conversationIds,
        refreshedAt: now,
        updatedAt: now,
      },
    });

  return true;
}

export async function getUserMemoryContext(clerkUserId: string): Promise<string> {
  if (!MEMORY_ENABLED) return "";

  const db = getDb();
  const [profile, periods, recentConversationMemory] = await Promise.all([
    loadProfile(clerkUserId),
    db
      .select({ cadence: userMemoryPeriods.cadence, summary: userMemoryPeriods.summary })
      .from(userMemoryPeriods)
      .where(eq(userMemoryPeriods.clerkUserId, clerkUserId))
      .orderBy(desc(userMemoryPeriods.periodStart))
      .limit(2),
    db.query.conversationMemories.findFirst({
      where: eq(conversationMemories.clerkUserId, clerkUserId),
    }),
  ]);

  const sections: string[] = [];

  if (profile?.profileSummary || profile?.preferencesJson.length || profile?.factsJson.length) {
    sections.push("User memory profile:");
    if (profile.profileSummary) sections.push(truncate(profile.profileSummary, 900));
    if (profile.preferencesJson.length) {
      sections.push(`Preferences: ${profile.preferencesJson.slice(0, 10).join("; ")}`);
    }
    if (profile.factsJson.length) {
      sections.push(`Stable user facts: ${profile.factsJson.slice(0, 10).join("; ")}`);
    }
    if (profile.feedbackPatternsJson.length) {
      sections.push(`Feedback patterns: ${profile.feedbackPatternsJson.slice(0, 8).join("; ")}`);
    }
  }

  const usefulPeriods = periods.filter((period) => period.summary.trim());
  if (usefulPeriods.length) {
    sections.push("Rolling memory summaries:");
    sections.push(
      usefulPeriods
        .map((period) => `- ${period.cadence}: ${truncate(period.summary, 700)}`)
        .join("\n")
    );
  }

  if (recentConversationMemory?.summary.trim()) {
    sections.push("Recent conversations memory:");
    const topics = recentConversationMemory.topicsJson.length
      ? ` Topics: ${recentConversationMemory.topicsJson.slice(0, 8).join(", ")}.`
      : "";
    sections.push(`${truncate(recentConversationMemory.summary, 900)}${topics}`);
  }

  if (sections.length === 0) return "";

  return truncate(
    [
      "Long-term personalization memory:",
      "Use this subtly to adapt tone, depth, source choices, and follow-up assumptions. Do not treat memory as doctrinal evidence; continue grounding factual claims in retrieved sources.",
      sections.join("\n"),
    ].join("\n\n"),
    MAX_MEMORY_CONTEXT_CHARS
  );
}

export async function getUserMemorySnapshot(clerkUserId: string) {
  const db = getDb();
  const [profile, periods, recentConversationMemory] = await Promise.all([
    loadProfile(clerkUserId),
    db
      .select({
        id: userMemoryPeriods.id,
        cadence: userMemoryPeriods.cadence,
        periodStart: userMemoryPeriods.periodStart,
        periodEnd: userMemoryPeriods.periodEnd,
        summary: userMemoryPeriods.summary,
        conversationRefsJson: userMemoryPeriods.conversationRefsJson,
        refreshedAt: userMemoryPeriods.refreshedAt,
      })
      .from(userMemoryPeriods)
      .where(eq(userMemoryPeriods.clerkUserId, clerkUserId))
      .orderBy(desc(userMemoryPeriods.periodStart))
      .limit(2),
    db.query.conversationMemories.findFirst({
      where: eq(conversationMemories.clerkUserId, clerkUserId),
    }),
  ]);

  return {
    profile: profile
      ? {
          profileSummary: profile.profileSummary,
          preferences: profile.preferencesJson,
          facts: profile.factsJson,
          feedbackPatterns: profile.feedbackPatternsJson,
          lastConversationAt: profile.lastConversationAt,
          lastProfiledAt: profile.lastProfiledAt,
          updatedAt: profile.updatedAt,
        }
      : null,
    periods: periods.map((period) => ({
      id: period.id,
      cadence: period.cadence,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      summary: period.summary,
      conversationCount: period.conversationRefsJson.length,
      refreshedAt: period.refreshedAt,
    })),
    conversationMemory: recentConversationMemory
      ? {
          summary: recentConversationMemory.summary,
          topics: recentConversationMemory.topicsJson,
          preferences: recentConversationMemory.preferencesJson,
          messageCount: recentConversationMemory.messageCount,
          lastMessageAt: recentConversationMemory.lastMessageAt,
          updatedAt: recentConversationMemory.updatedAt,
        }
      : null,
  };
}

function formatMessagesForMemory(inputMessages: Array<{ role: string; content: string }>) {
  return inputMessages
    .map((message, index) => {
      const role = message.role === "assistant" ? "Assistant" : "User";
      return `${index + 1}. ${role}: ${truncate(message.content, 1800)}`;
    })
    .join("\n\n");
}

function isConversationMemoryFresh(
  existing: { lastMessageAt: Date | null; updatedAt: Date },
  conversationUpdatedAt: Date
) {
  const trackedAt = existing.lastMessageAt ?? existing.updatedAt;
  return trackedAt.getTime() >= conversationUpdatedAt.getTime();
}

async function refreshRecentConversationMemory({
  clerkUserId,
  force,
  conversationLimit,
}: {
  clerkUserId: string;
  force: boolean;
  conversationLimit: number;
}): Promise<{ status: ConversationRefreshStatus; conversationsScanned: number }> {
  const db = getDb();
  const existing = await db.query.conversationMemories.findFirst({
    where: eq(conversationMemories.clerkUserId, clerkUserId),
  });
  const input = await loadConversationMemoryInput({
    clerkUserId,
    limit: conversationLimit,
  });

  if (!input.latestConversationAt || input.sections.length === 0) {
    return { status: "empty", conversationsScanned: input.conversations.length };
  }

  if (existing && !force && isConversationMemoryFresh(existing, input.latestConversationAt)) {
    return { status: "skipped", conversationsScanned: input.conversations.length };
  }

  const prompt = [
    "Update one compact recent-conversations memory for a personal LDS RAG assistant.",
    "Capture only personalization signals: user interests, recurring goals, explicit preferences, durable corrections, and stable user facts intentionally shared.",
    "Preserve useful existing memory, add new useful signals, and remove stale details if contradicted.",
    "Do not store source text, citations, doctrinal claims, private speculation, or sensitive inferences. Keep this as one ongoing summary, not one note per conversation.",
    "Existing recent-conversations memory:",
    existing?.summary || "(none)",
    "Recent conversations:",
    input.sections.join("\n\n---\n\n"),
  ].join("\n\n");

  let object: z.infer<typeof conversationMemorySchema>;
  try {
    const result = await generateObject({
      model: gateway(MEMORY_MODEL),
      schema: conversationMemorySchema,
      system: "You write concise durable memory for personalization. Return only fields matching the schema.",
      prompt: truncate(prompt, MAX_SUMMARY_INPUT_CHARS),
    });
    object = result.object;
  } catch (error) {
    console.error("Failed to refresh conversation memory", {
      clerkUserId,
      error,
    });
    return { status: "failed", conversationsScanned: input.conversations.length };
  }

  if (!object.summary.trim()) {
    return { status: "empty", conversationsScanned: input.conversations.length };
  }

  const profile = await loadProfile(clerkUserId);
  const now = new Date();

  await db
    .insert(conversationMemories)
    .values({
      clerkUserId,
      summary: truncate(object.summary.trim().replace(/\s+/g, " "), 1500),
      topicsJson: compactItems(object.topics, 16),
      preferencesJson: compactItems(object.preferences, 16),
      messageCount: input.messagesIncluded,
      lastMessageAt: input.latestConversationAt,
      summarizedAt: now,
    })
    .onConflictDoUpdate({
      target: conversationMemories.clerkUserId,
      set: {
        summary: truncate(object.summary.trim().replace(/\s+/g, " "), 1500),
        topicsJson: compactItems(object.topics, 16),
        preferencesJson: compactItems(object.preferences, 16),
        messageCount: input.messagesIncluded,
        lastMessageAt: input.latestConversationAt,
        summarizedAt: now,
        updatedAt: now,
      },
    });

  await db
    .insert(userMemoryProfiles)
    .values({
      clerkUserId,
      profileSummary: mergeSummary(profile?.profileSummary, object.summary, 1400),
      preferencesJson: compactItems([
        ...object.preferences,
        ...(profile?.preferencesJson ?? []),
      ], 24),
      factsJson: compactItems([...object.facts, ...(profile?.factsJson ?? [])], 24),
      feedbackPatternsJson: compactItems([
        ...object.feedbackPatterns,
        ...(profile?.feedbackPatternsJson ?? []),
      ], 20),
      lastConversationAt: input.latestConversationAt,
      lastProfiledAt: now,
    })
    .onConflictDoUpdate({
      target: userMemoryProfiles.clerkUserId,
      set: {
        profileSummary: mergeSummary(profile?.profileSummary, object.summary, 1400),
        preferencesJson: compactItems([
          ...object.preferences,
          ...(profile?.preferencesJson ?? []),
        ], 24),
        factsJson: compactItems([...object.facts, ...(profile?.factsJson ?? [])], 24),
        feedbackPatternsJson: compactItems([
          ...object.feedbackPatterns,
          ...(profile?.feedbackPatternsJson ?? []),
        ], 20),
        lastConversationAt: input.latestConversationAt,
        lastProfiledAt: now,
        updatedAt: now,
      },
    });

  return { status: "updated", conversationsScanned: input.conversations.length };
}

export async function refreshUserMemory(
  clerkUserId: string,
  options: { force?: boolean; forcePeriods?: boolean; conversationLimit?: number } = {}
) {
  if (!MEMORY_ENABLED) {
    return {
      enabled: false,
      conversationsScanned: 0,
      conversationsUpdated: 0,
      conversationsSkipped: 0,
      conversationsFailed: 0,
      periodsUpdated: 0,
    };
  }

  const now = new Date();
  const force = options.force ?? true;
  const forcePeriods = options.forcePeriods ?? force;
  const conversationLimit = options.conversationLimit ?? MANUAL_REFRESH_CONVERSATION_LIMIT;
  const conversationMemoryResult = await refreshRecentConversationMemory({
    clerkUserId,
    force,
    conversationLimit,
  });

  const periodResults = await Promise.all([
    refreshPeriodSummary(clerkUserId, "weekly", now, { force: forcePeriods }),
    refreshPeriodSummary(clerkUserId, "monthly", now, { force: forcePeriods }),
  ]);

  return {
    enabled: true,
    conversationsScanned: conversationMemoryResult.conversationsScanned,
    conversationsUpdated: conversationMemoryResult.status === "updated" ? 1 : 0,
    conversationsSkipped: conversationMemoryResult.status === "skipped" ? 1 : 0,
    conversationsFailed: conversationMemoryResult.status === "failed" ? 1 : 0,
    periodsUpdated: periodResults.filter(Boolean).length,
  };
}

export async function refreshActiveUsersMemory(options: { userLimit?: number } = {}) {
  if (!MEMORY_ENABLED) {
    return {
      enabled: false,
      usersScanned: 0,
      usersUpdated: 0,
      conversationsScanned: 0,
      conversationsUpdated: 0,
      conversationsSkipped: 0,
      conversationsFailed: 0,
      periodsUpdated: 0,
      results: [],
    };
  }

  const db = getDb();
  const userLimit = options.userLimit ?? CRON_REFRESH_USER_LIMIT;
  const recentConversationOwners = await db
    .select({ clerkUserId: conversations.clerkUserId })
    .from(conversations)
    .orderBy(desc(conversations.updatedAt))
    .limit(userLimit * 20);

  const userIds = [...new Set(recentConversationOwners.map((row) => row.clerkUserId))]
    .slice(0, userLimit);

  const results = [];
  for (const userId of userIds) {
    const result = await refreshUserMemory(userId, {
      force: false,
      forcePeriods: false,
      conversationLimit: CRON_REFRESH_CONVERSATION_LIMIT,
    });
    results.push({ userId, ...result });
  }

  return {
    enabled: true,
    usersScanned: userIds.length,
    usersUpdated: results.filter(
      (result) => result.conversationsUpdated > 0 || result.periodsUpdated > 0
    ).length,
    conversationsScanned: results.reduce(
      (total, result) => total + result.conversationsScanned,
      0
    ),
    conversationsUpdated: results.reduce(
      (total, result) => total + result.conversationsUpdated,
      0
    ),
    conversationsSkipped: results.reduce(
      (total, result) => total + result.conversationsSkipped,
      0
    ),
    conversationsFailed: results.reduce(
      (total, result) => total + result.conversationsFailed,
      0
    ),
    periodsUpdated: results.reduce((total, result) => total + result.periodsUpdated, 0),
    results,
  };
}

export async function recordPersonalMemory({
  clerkUserId,
  summary,
  preferences = [],
  facts = [],
  feedbackPatterns = [],
  occurredAt = new Date(),
}: RecordPersonalMemoryInput): Promise<void> {
  if (!MEMORY_ENABLED) return;

  try {
    const db = getDb();
    const profile = await loadProfile(clerkUserId);
    const profileSummary = mergeSummary(profile?.profileSummary, summary, 1400);

    await db
      .insert(userMemoryProfiles)
      .values({
        clerkUserId,
        profileSummary,
        preferencesJson: compactItems([
          ...preferences,
          ...(profile?.preferencesJson ?? []),
        ], 24),
        factsJson: compactItems([...facts, ...(profile?.factsJson ?? [])], 24),
        feedbackPatternsJson: compactItems([
          ...feedbackPatterns,
          ...(profile?.feedbackPatternsJson ?? []),
        ], 20),
        lastConversationAt: occurredAt,
        lastProfiledAt: occurredAt,
      })
      .onConflictDoUpdate({
        target: userMemoryProfiles.clerkUserId,
        set: {
          profileSummary,
          preferencesJson: compactItems([
            ...preferences,
            ...(profile?.preferencesJson ?? []),
          ], 24),
          factsJson: compactItems([...facts, ...(profile?.factsJson ?? [])], 24),
          feedbackPatternsJson: compactItems([
            ...feedbackPatterns,
            ...(profile?.feedbackPatternsJson ?? []),
          ], 20),
          lastConversationAt: occurredAt,
          lastProfiledAt: occurredAt,
          updatedAt: occurredAt,
        },
      });

  } catch (error) {
    console.error("Failed to update user memory profile", error);
  }
}


export function createMemoryTools({
  clerkUserId,
}: {
  clerkUserId: string;
}) {
  return {
    update_personal_memory: tool({
      description:
        "Store durable personalization memory when the user explicitly asks you to remember something, states a stable preference, gives a durable correction, or shares recurring goals. Do not use for ordinary topical questions, retrieved source content, doctrine claims, or sensitive speculation.",
      inputSchema: z.object({
        summary: z
          .string()
          .min(1)
          .max(700)
          .describe("A concise durable memory note, written as a neutral third-person summary."),
        preferences: z
          .array(z.string().trim().min(1).max(160))
          .max(8)
          .default([])
          .describe("Explicit user preferences for tone, depth, language, sources, or workflow."),
        facts: z
          .array(z.string().trim().min(1).max(160))
          .max(8)
          .default([])
          .describe("Stable facts the user intentionally shared about themself. Avoid sensitive inferences."),
        feedbackPatterns: z
          .array(z.string().trim().min(1).max(160))
          .max(8)
          .default([])
          .describe("Durable answer-quality feedback patterns, if explicitly stated."),
      }),
      execute: async ({ summary, preferences, facts, feedbackPatterns }) => {
        await recordPersonalMemory({
          clerkUserId,
          summary,
          preferences,
          facts,
          feedbackPatterns,
        });

        return {
          ok: true,
          stored: true,
          note: "Personalization memory updated. Continue answering normally without exposing the stored memory unless the user asks.",
        };
      },
    }),
  };
}

export async function recordFeedbackMemory({
  clerkUserId,
  feedback,
  comment,
  question,
  answerText,
}: RecordFeedbackMemoryInput): Promise<void> {
  if (!MEMORY_ENABLED) return;
  if (feedback === "up" && !comment?.trim()) return;

  try {
    const db = getDb();
    const profile = await loadProfile(clerkUserId);
    const now = new Date();

    const prompt = [
      "Update a user memory profile from explicit feedback on an assistant answer.",
      "Capture only durable preferences and feedback patterns. Do not store the full answer or private speculation.",
      "Existing profile summary:",
      profile?.profileSummary || "(none)",
      "Existing preferences:",
      profile?.preferencesJson.join("; ") || "(none)",
      "Existing feedback patterns:",
      profile?.feedbackPatternsJson.join("; ") || "(none)",
      `Feedback: ${feedback}`,
      `Comment: ${comment || "(none)"}`,
      "Question:",
      truncate(question ?? "", 1600) || "(none)",
      "Answer excerpt:",
      truncate(answerText ?? "", 2400) || "(none)",
    ].join("\n\n");

    const { object } = await generateObject({
      model: gateway(MEMORY_MODEL),
      schema: feedbackMemorySchema,
      system: "You maintain concise durable feedback memory. Return only fields matching the schema.",
      prompt: truncate(prompt, MAX_SUMMARY_INPUT_CHARS),
    });

    await db
      .insert(userMemoryProfiles)
      .values({
        clerkUserId,
        profileSummary: object.profileSummary,
        preferencesJson: compactItems([
          ...object.preferences,
          ...(profile?.preferencesJson ?? []),
        ], 24),
        feedbackPatternsJson: compactItems([
          ...object.feedbackPatterns,
          ...(profile?.feedbackPatternsJson ?? []),
        ], 20),
        factsJson: profile?.factsJson ?? [],
        lastProfiledAt: now,
      })
      .onConflictDoUpdate({
        target: userMemoryProfiles.clerkUserId,
        set: {
          profileSummary: object.profileSummary || profile?.profileSummary || "",
          preferencesJson: compactItems([
            ...object.preferences,
            ...(profile?.preferencesJson ?? []),
          ], 24),
          feedbackPatternsJson: compactItems([
            ...object.feedbackPatterns,
            ...(profile?.feedbackPatternsJson ?? []),
          ], 20),
          factsJson: profile?.factsJson ?? [],
          lastProfiledAt: now,
          updatedAt: now,
        },
      });
  } catch (error) {
    console.error("Failed to update feedback memory", error);
  }
}