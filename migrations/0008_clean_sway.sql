CREATE TABLE "rag_user_settings" (
	"clerk_user_id" text PRIMARY KEY NOT NULL,
	"default_response_style" text DEFAULT 'balanced' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rag_conversations" ADD COLUMN "response_style" text;