ALTER TABLE "rag_conversation_memories" DROP CONSTRAINT IF EXISTS "rag_conversation_memories_conversation_id_rag_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "rag_conversation_memories" DROP CONSTRAINT IF EXISTS "rag_conversation_memories_pkey";
--> statement-breakpoint
TRUNCATE TABLE "rag_conversation_memories";
--> statement-breakpoint
ALTER TABLE "rag_conversation_memories" DROP COLUMN IF EXISTS "conversation_id";
--> statement-breakpoint
ALTER TABLE "rag_conversation_memories" ADD PRIMARY KEY ("clerk_user_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "rag_user_memory_periods_unique_idx";
--> statement-breakpoint
TRUNCATE TABLE "rag_user_memory_periods";
--> statement-breakpoint
CREATE UNIQUE INDEX "rag_user_memory_periods_unique_idx" ON "rag_user_memory_periods" USING btree ("clerk_user_id","cadence");