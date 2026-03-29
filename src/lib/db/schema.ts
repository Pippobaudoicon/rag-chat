import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { SourceChunk, SourceType } from "@/lib/types";

// One conversation per user topic — owns all messages
export const conversations = pgTable("rag_conversations", {
  id: serial("id").primaryKey(),
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
});

// Full message history per conversation — enables multi-turn memory
export const messages = pgTable("rag_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  // Source chunks stored on assistant messages only
  sourcesJson: jsonb("sources_json").$type<SourceChunk[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
