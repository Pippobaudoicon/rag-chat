CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
ALTER TABLE "rag_conversations" ADD COLUMN "uuid_id" uuid DEFAULT gen_random_uuid();--> statement-breakpoint
UPDATE "rag_conversations" SET "uuid_id" = gen_random_uuid() WHERE "uuid_id" IS NULL;--> statement-breakpoint
ALTER TABLE "rag_conversations" ALTER COLUMN "uuid_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_messages" ADD COLUMN "conversation_uuid" uuid;--> statement-breakpoint
UPDATE "rag_messages"
SET "conversation_uuid" = "rag_conversations"."uuid_id"
FROM "rag_conversations"
WHERE "rag_messages"."conversation_id" = "rag_conversations"."id";--> statement-breakpoint
ALTER TABLE "rag_messages" ALTER COLUMN "conversation_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_message_feedback" ADD COLUMN "conversation_uuid" uuid;--> statement-breakpoint
UPDATE "rag_message_feedback"
SET "conversation_uuid" = "rag_conversations"."uuid_id"
FROM "rag_conversations"
WHERE "rag_message_feedback"."conversation_id" = "rag_conversations"."id";--> statement-breakpoint
ALTER TABLE "rag_message_feedback" ALTER COLUMN "conversation_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_messages" DROP CONSTRAINT IF EXISTS "rag_messages_conversation_id_rag_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "rag_message_feedback" DROP CONSTRAINT IF EXISTS "rag_message_feedback_conversation_id_rag_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "rag_conversations" DROP CONSTRAINT IF EXISTS "rag_conversations_pkey";--> statement-breakpoint
ALTER TABLE "rag_messages" DROP COLUMN "conversation_id";--> statement-breakpoint
ALTER TABLE "rag_message_feedback" DROP COLUMN "conversation_id";--> statement-breakpoint
ALTER TABLE "rag_conversations" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "rag_conversations" RENAME COLUMN "uuid_id" TO "id";--> statement-breakpoint
ALTER TABLE "rag_messages" RENAME COLUMN "conversation_uuid" TO "conversation_id";--> statement-breakpoint
ALTER TABLE "rag_message_feedback" RENAME COLUMN "conversation_uuid" TO "conversation_id";--> statement-breakpoint
ALTER TABLE "rag_conversations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "rag_conversations" ADD CONSTRAINT "rag_conversations_pkey" PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "rag_messages" ADD CONSTRAINT "rag_messages_conversation_id_rag_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."rag_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_message_feedback" ADD CONSTRAINT "rag_message_feedback_conversation_id_rag_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."rag_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rag_conversations_user_updated_idx" ON "rag_conversations" USING btree ("clerk_user_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "rag_feedback_conversation_user_idx" ON "rag_message_feedback" USING btree ("conversation_id","clerk_user_id","created_at");--> statement-breakpoint
CREATE INDEX "rag_feedback_assistant_user_idx" ON "rag_message_feedback" USING btree ("assistant_message_id","clerk_user_id");--> statement-breakpoint
CREATE INDEX "rag_messages_conversation_created_idx" ON "rag_messages" USING btree ("conversation_id","created_at");