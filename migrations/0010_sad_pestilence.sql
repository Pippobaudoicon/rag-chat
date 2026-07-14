ALTER TABLE "rag_conversations" ADD COLUMN "generation_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_conversations" ADD COLUMN "active_turn_id" text;--> statement-breakpoint
ALTER TABLE "rag_conversations" ADD COLUMN "active_stream_id" text;--> statement-breakpoint
ALTER TABLE "rag_conversations" ADD COLUMN "generation_started_at" timestamp;