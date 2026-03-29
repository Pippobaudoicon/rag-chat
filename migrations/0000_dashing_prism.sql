CREATE TABLE "rag_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"title" text,
	"language" text DEFAULT 'ita' NOT NULL,
	"sources" jsonb DEFAULT '["scriptures","conference","handbook"]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"sources_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rag_messages" ADD CONSTRAINT "rag_messages_conversation_id_rag_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."rag_conversations"("id") ON DELETE cascade ON UPDATE no action;