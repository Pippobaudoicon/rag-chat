import { index, pgTable, serial, text, integer, timestamp, jsonb, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import type {
  AssistantVersion,
  MessageDetails,
  SourceChunk,
  SourceType,
} from "@/lib/types";

// One conversation per user topic — owns all messages
export const conversations = pgTable(
  "rag_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Clerk userId as ownership key — no shared DB with hymns/
    clerkUserId: text("clerk_user_id").notNull(),
    title: text("title"), // null until first message auto-titles it
    language: text("language").notNull().default("ita"),
    sources: jsonb("sources")
      .$type<SourceType[]>()
      .notNull()
      .default(["scriptures", "conference", "handbook"]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("rag_conversations_user_updated_idx").on(
      table.clerkUserId,
      table.updatedAt,
      table.id
    ),
  ]
);

// Full message history per conversation — enables multi-turn memory
export const messages = pgTable("rag_messages", {
  id: serial("id").primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  // Source chunks stored on assistant messages only
  sourcesJson: jsonb("sources_json").$type<SourceChunk[]>(),
  // Regenerated assistant alternatives (including current one) for branch switching
  versionsJson: jsonb("versions_json").$type<AssistantVersion[]>(),
  // Response details (tokens, latency, model, finish reason)
  detailsJson: jsonb("details_json").$type<MessageDetails>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("rag_messages_conversation_created_idx").on(
    table.conversationId,
    table.createdAt
  ),
]);

// User feedback events for assistant answers (thumbs up/down)
export const messageFeedback = pgTable("rag_message_feedback", {
  id: serial("id").primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  assistantMessageId: integer("assistant_message_id").references(() => messages.id, {
    onDelete: "set null",
  }),
  clerkUserId: text("clerk_user_id").notNull(),
  clientMessageId: text("client_message_id"),
  feedback: text("feedback").notNull(), // 'up' | 'down'
  comment: text("comment"),
  question: text("question"),
  answerText: text("answer_text"),
  sourcesJson: jsonb("sources_json").$type<SourceChunk[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("rag_feedback_conversation_user_idx").on(
    table.conversationId,
    table.clerkUserId,
    table.createdAt
  ),
  index("rag_feedback_assistant_user_idx").on(
    table.assistantMessageId,
    table.clerkUserId
  ),
]);

// Long-lived user profile distilled from conversations and feedback.
export const userMemoryProfiles = pgTable("rag_user_memory_profiles", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  profileSummary: text("profile_summary").notNull().default(""),
  preferencesJson: jsonb("preferences_json").$type<string[]>().notNull().default([]),
  factsJson: jsonb("facts_json").$type<string[]>().notNull().default([]),
  feedbackPatternsJson: jsonb("feedback_patterns_json").$type<string[]>().notNull().default([]),
  lastConversationAt: timestamp("last_conversation_at"),
  lastProfiledAt: timestamp("last_profiled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Compact per-conversation memory. Source text is intentionally omitted.
export const conversationMemories = pgTable(
  "rag_conversation_memories",
  {
    conversationId: uuid("conversation_id")
      .primaryKey()
      .references(() => conversations.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    summary: text("summary").notNull().default(""),
    topicsJson: jsonb("topics_json").$type<string[]>().notNull().default([]),
    preferencesJson: jsonb("preferences_json").$type<string[]>().notNull().default([]),
    messageCount: integer("message_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at"),
    summarizedAt: timestamp("summarized_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("rag_conversation_memories_user_updated_idx").on(
      table.clerkUserId,
      table.updatedAt
    ),
  ]
);

// Weekly/monthly rollups derived from compact conversation memories.
export const userMemoryPeriods = pgTable(
  "rag_user_memory_periods",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    cadence: text("cadence").notNull(), // 'weekly' | 'monthly'
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    summary: text("summary").notNull().default(""),
    conversationRefsJson: jsonb("conversation_refs_json").$type<string[]>().notNull().default([]),
    refreshedAt: timestamp("refreshed_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("rag_user_memory_periods_unique_idx").on(
      table.clerkUserId,
      table.cadence,
      table.periodStart
    ),
    index("rag_user_memory_periods_user_cadence_idx").on(
      table.clerkUserId,
      table.cadence,
      table.periodStart
    ),
  ]
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageFeedback = typeof messageFeedback.$inferSelect;
export type NewMessageFeedback = typeof messageFeedback.$inferInsert;
export type UserMemoryProfile = typeof userMemoryProfiles.$inferSelect;
export type NewUserMemoryProfile = typeof userMemoryProfiles.$inferInsert;
export type ConversationMemory = typeof conversationMemories.$inferSelect;
export type NewConversationMemory = typeof conversationMemories.$inferInsert;
export type UserMemoryPeriod = typeof userMemoryPeriods.$inferSelect;
export type NewUserMemoryPeriod = typeof userMemoryPeriods.$inferInsert;
