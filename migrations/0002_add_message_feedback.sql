CREATE TABLE "rag_message_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"assistant_message_id" integer,
	"clerk_user_id" text NOT NULL,
	"client_message_id" text,
	"feedback" text NOT NULL,
	"question" text,
	"answer_text" text,
	"sources_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rag_message_feedback" ADD CONSTRAINT "rag_message_feedback_conversation_id_rag_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."rag_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rag_message_feedback" ADD CONSTRAINT "rag_message_feedback_assistant_message_id_rag_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."rag_messages"("id") ON DELETE set null ON UPDATE no action;
