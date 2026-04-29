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
import type { Language } from "@/lib/types";

type MemoryCadence = "weekly" | "monthly";
type ConversationRefreshStatus = "updated" | "skipped" | "empty";

interface RecordPersonalMemoryInput {
  clerkUserId: string;
  conversationId: string;
  language: Language;
  summary: string;
  topics?: string[];
  preferences?: string[];
  facts?: string[];
  feedbackPatterns?: string[];
  messageCount?: number;
  replaceConversationSummary?: boolean;
  refreshPeriods?: boolean;
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
  10
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
      eq(userMemoryPeriods.cadence, cadence),
      eq(userMemoryPeriods.periodStart, periodStart)
    ),
  });

  if (existing?.summary && !options.force && !shouldRefreshPeriod(existing.refreshedAt)) {
    return false;
  }

  const conversations = await db
    .select({
      conversationId: conversationMemories.conversationId,
      summary: conversationMemories.summary,
      topicsJson: conversationMemories.topicsJson,
      lastMessageAt: conversationMemories.lastMessageAt,
    })
    .from(conversationMemories)
    .where(
      and(
        eq(conversationMemories.clerkUserId, clerkUserId),
        gte(conversationMemories.lastMessageAt, periodStart),
        lt(conversationMemories.lastMessageAt, periodEnd)
      )
    )
    .orderBy(desc(conversationMemories.lastMessageAt))
    .limit(50);

  if (conversations.length === 0) return false;

  const prompt = [
    `Create a compact ${cadence} memory rollup for a personal LDS RAG assistant.`,
    "Summarize durable user interests, recurring questions, preferences, and feedback patterns.",
    "Do not include private speculation. Do not quote full source text. Keep it useful for future personalization.",
    `Period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`,
    "Conversation memories:",
    conversations.map((conversation, index) => {
      const topics = conversation.topicsJson?.length
        ? `Topics: ${conversation.topicsJson.join(", ")}`
        : "";
      return `${index + 1}. ${truncate(conversation.summary, 900)} ${topics}`.trim();
    }).join("\n"),
  ].join("\n\n");

  const { object } = await generateObject({
    model: gateway(MEMORY_MODEL),
    schema: periodSummarySchema,
    system: "You write concise durable memory summaries for personalization. Return only fields matching the schema.",
    prompt: truncate(prompt, MAX_SUMMARY_INPUT_CHARS),
  });

  await db
    .insert(userMemoryPeriods)
    .values({
      clerkUserId,
      cadence,
      periodStart,
      periodEnd,
      summary: object.summary,
      conversationRefsJson: conversations.map((conversation) => conversation.conversationId),
      refreshedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        userMemoryPeriods.clerkUserId,
        userMemoryPeriods.cadence,
        userMemoryPeriods.periodStart,
      ],
      set: {
        periodEnd,
        summary: object.summary,
        conversationRefsJson: conversations.map((conversation) => conversation.conversationId),
        refreshedAt: now,
        updatedAt: now,
      },
    });

  return true;
}

export async function getUserMemoryContext(clerkUserId: string): Promise<string> {
  if (!MEMORY_ENABLED) return "";

  const db = getDb();
  const [profile, periods, recentConversations] = await Promise.all([
    loadProfile(clerkUserId),
    db
      .select({ cadence: userMemoryPeriods.cadence, summary: userMemoryPeriods.summary })
      .from(userMemoryPeriods)
      .where(eq(userMemoryPeriods.clerkUserId, clerkUserId))
      .orderBy(desc(userMemoryPeriods.periodStart))
      .limit(4),
    db
      .select({ summary: conversationMemories.summary, topicsJson: conversationMemories.topicsJson })
      .from(conversationMemories)
      .where(eq(conversationMemories.clerkUserId, clerkUserId))
      .orderBy(desc(conversationMemories.updatedAt))
      .limit(5),
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

  const usefulConversations = recentConversations.filter((conversation) => conversation.summary.trim());
  if (usefulConversations.length) {
    sections.push("Recent conversation memories:");
    sections.push(
      usefulConversations
        .map((conversation) => {
          const topics = conversation.topicsJson?.length
            ? ` Topics: ${conversation.topicsJson.slice(0, 5).join(", ")}.`
            : "";
          return `- ${truncate(conversation.summary, 450)}${topics}`;
        })
        .join("\n")
    );
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
  const [profile, periods, recentConversations] = await Promise.all([
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
      .limit(12),
    db
      .select({
        conversationId: conversationMemories.conversationId,
        title: conversations.title,
        summary: conversationMemories.summary,
        topicsJson: conversationMemories.topicsJson,
        preferencesJson: conversationMemories.preferencesJson,
        lastMessageAt: conversationMemories.lastMessageAt,
        updatedAt: conversationMemories.updatedAt,
      })
      .from(conversationMemories)
      .leftJoin(conversations, eq(conversations.id, conversationMemories.conversationId))
      .where(eq(conversationMemories.clerkUserId, clerkUserId))
      .orderBy(desc(conversationMemories.updatedAt))
      .limit(20),
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
    conversations: recentConversations.map((conversation) => ({
      conversationId: conversation.conversationId,
      title: conversation.title,
      summary: conversation.summary,
      topics: conversation.topicsJson,
      preferences: conversation.preferencesJson,
      lastMessageAt: conversation.lastMessageAt,
      updatedAt: conversation.updatedAt,
    })),
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

async function refreshConversationMemoryFromMessages({
  clerkUserId,
  conversationId,
  title,
  language,
  updatedAt,
  force,
}: {
  clerkUserId: string;
  conversationId: string;
  title: string | null;
  language: Language;
  updatedAt: Date;
  force: boolean;
}): Promise<ConversationRefreshStatus> {
  const db = getDb();
  const existing = await db.query.conversationMemories.findFirst({
    where: eq(conversationMemories.conversationId, conversationId),
  });

  if (existing && !force && isConversationMemoryFresh(existing, updatedAt)) {
    return "skipped";
  }

  const storedMessages = await db
    .select({ role: messages.role, content: messages.content, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(MANUAL_REFRESH_MESSAGE_LIMIT);

  if (storedMessages.length === 0) return "empty";

  const orderedMessages = storedMessages.reverse();
  const prompt = [
    "Create a compact durable memory summary for this conversation in a personal LDS RAG assistant.",
    "Capture only personalization signals: user interests, recurring goals, explicit preferences, durable corrections, and stable user facts intentionally shared.",
    "Do not store source text, citations, doctrinal claims, private speculation, or sensitive inferences.",
    `Conversation title: ${title || "Untitled conversation"}`,
    `Conversation language: ${language}`,
    "Messages:",
    formatMessagesForMemory(orderedMessages),
  ].join("\n\n");

  const { object } = await generateObject({
    model: gateway(MEMORY_MODEL),
    schema: conversationMemorySchema,
    system: "You write concise durable memory for personalization. Return only fields matching the schema.",
    prompt: truncate(prompt, MAX_SUMMARY_INPUT_CHARS),
  });

  if (!object.summary.trim()) return "empty";

  await recordPersonalMemory({
    clerkUserId,
    conversationId,
    language,
    summary: object.summary,
    topics: object.topics,
    preferences: object.preferences,
    facts: object.facts,
    feedbackPatterns: object.feedbackPatterns,
    messageCount: orderedMessages.length,
    replaceConversationSummary: true,
    refreshPeriods: false,
    occurredAt: updatedAt,
  });

  return "updated";
}

export async function refreshUserMemory(
  clerkUserId: string,
  options: { force?: boolean; forcePeriods?: boolean } = {}
) {
  if (!MEMORY_ENABLED) {
    return {
      enabled: false,
      conversationsScanned: 0,
      conversationsUpdated: 0,
      conversationsSkipped: 0,
      periodsUpdated: 0,
    };
  }

  const db = getDb();
  const now = new Date();
  const force = options.force ?? true;
  const forcePeriods = options.forcePeriods ?? force;
  const recentConversations = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      language: conversations.language,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.clerkUserId, clerkUserId))
    .orderBy(desc(conversations.updatedAt))
    .limit(MANUAL_REFRESH_CONVERSATION_LIMIT);

  let conversationsUpdated = 0;
  let conversationsSkipped = 0;

  for (const conversation of recentConversations) {
    const status = await refreshConversationMemoryFromMessages({
      clerkUserId,
      conversationId: conversation.id,
      title: conversation.title,
      language: conversation.language as Language,
      updatedAt: conversation.updatedAt,
      force,
    });

    if (status === "updated") conversationsUpdated += 1;
    if (status === "skipped") conversationsSkipped += 1;
  }

  const periodResults = await Promise.all([
    refreshPeriodSummary(clerkUserId, "weekly", now, { force: forcePeriods }),
    refreshPeriodSummary(clerkUserId, "monthly", now, { force: forcePeriods }),
  ]);

  return {
    enabled: true,
    conversationsScanned: recentConversations.length,
    conversationsUpdated,
    conversationsSkipped,
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
    periodsUpdated: results.reduce((total, result) => total + result.periodsUpdated, 0),
    results,
  };
}

export async function recordPersonalMemory({
  clerkUserId,
  conversationId,
  language,
  summary,
  topics = [],
  preferences = [],
  facts = [],
  feedbackPatterns = [],
  messageCount,
  replaceConversationSummary = false,
  refreshPeriods = true,
  occurredAt = new Date(),
}: RecordPersonalMemoryInput): Promise<void> {
  if (!MEMORY_ENABLED) return;

  try {
    const db = getDb();
    const [existingConversationMemory, profile] = await Promise.all([
      db.query.conversationMemories.findFirst({
        where: eq(conversationMemories.conversationId, conversationId),
      }),
      loadProfile(clerkUserId),
    ]);

    const mergedTopics = compactItems(
      [...topics, ...(existingConversationMemory?.topicsJson ?? [])],
      16
    );
    const conversationPreferences = compactItems(
      [...preferences, ...(existingConversationMemory?.preferencesJson ?? [])],
      16
    );
    const conversationSummary = replaceConversationSummary
      ? truncate(summary.trim().replace(/\s+/g, " "), 1500)
      : mergeSummary(existingConversationMemory?.summary, summary, 1500);
    const profileSummary = mergeSummary(profile?.profileSummary, summary, 1400);
    const nextMessageCount = messageCount ?? (existingConversationMemory?.messageCount ?? 0) + 1;

    await db
      .insert(conversationMemories)
      .values({
        conversationId,
        clerkUserId,
        summary: conversationSummary,
        topicsJson: mergedTopics,
        preferencesJson: conversationPreferences,
        messageCount: nextMessageCount,
        lastMessageAt: occurredAt,
        summarizedAt: occurredAt,
      })
      .onConflictDoUpdate({
        target: conversationMemories.conversationId,
        set: {
          summary: conversationSummary,
          topicsJson: mergedTopics,
          preferencesJson: conversationPreferences,
          messageCount: nextMessageCount,
          lastMessageAt: occurredAt,
          summarizedAt: occurredAt,
          updatedAt: occurredAt,
        },
      });

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

    if (refreshPeriods) {
      await refreshPeriodSummary(clerkUserId, "weekly", occurredAt);
      await refreshPeriodSummary(clerkUserId, "monthly", occurredAt);
    }
  } catch (error) {
    console.error("Failed to update conversation memory", error);
  }
}


export function createMemoryTools({
  clerkUserId,
  conversationId,
  language,
}: {
  clerkUserId: string;
  conversationId: string;
  language: Language;
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
        topics: z
          .array(z.string().trim().min(1).max(80))
          .max(8)
          .default([])
          .describe("Recurring topics or interests this memory is about."),
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
      execute: async ({ summary, topics, preferences, facts, feedbackPatterns }) => {
        await recordPersonalMemory({
          clerkUserId,
          conversationId,
          language,
          summary,
          topics,
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