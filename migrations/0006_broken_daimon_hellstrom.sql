CREATE TABLE "rag_conversation_memories" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"topics_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferences_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp,
	"summarized_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_user_memory_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"cadence" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"conversation_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refreshed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_user_memory_profiles" (
	"clerk_user_id" text PRIMARY KEY NOT NULL,
	"profile_summary" text DEFAULT '' NOT NULL,
	"preferences_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"facts_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"feedback_patterns_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_conversation_at" timestamp,
	"last_profiled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rag_conversation_memories" ADD CONSTRAINT "rag_conversation_memories_conversation_id_rag_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."rag_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rag_conversation_memories_user_updated_idx" ON "rag_conversation_memories" USING btree ("clerk_user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rag_user_memory_periods_unique_idx" ON "rag_user_memory_periods" USING btree ("clerk_user_id","cadence","period_start");--> statement-breakpoint
CREATE INDEX "rag_user_memory_periods_user_cadence_idx" ON "rag_user_memory_periods" USING btree ("clerk_user_id","cadence","period_start");