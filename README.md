# LDS RAG Chat

Authenticated Next.js app for LDS-focused retrieval-augmented chat. It stores
conversation history in Neon Postgres, retrieves source chunks from Pinecone,
uses Voyage AI embeddings, streams answers through the Vercel AI SDK, and keeps
response source metadata for citations and source cards.

## Getting Started

Install dependencies and create a local env file:

```bash
npm install
cp .env.example .env.local
```

Fill the required Clerk, Neon, Upstash, Voyage, and Pinecone values, then run:

```bash
npm run dev
```

Open [http://localhost:3000/chat](http://localhost:3000/chat).

## Useful Commands

```bash
npm run typecheck
npm run build
npm run db:generate
npm run db:migrate
npm run docs:guard
```

## High-Signal Files

- `src/app/api/chat/route.ts` streams RAG answers and persists messages.
- `src/lib/rag/retriever.ts` embeds queries and retrieves Pinecone chunks.
- `src/lib/db/schema.ts` defines conversations, messages, and feedback.
- `src/components/chat/ChatInterface.tsx` owns the main chat state and actions.
- `docs/PROJECT_INFO.md` is the project knowledge base for future agent work.

## Notes

- Conversation URLs and API identifiers use UUIDs.
- Message IDs remain integer database IDs for feedback and regeneration.
- Update `docs/PROJECT_INFO.md` when changing core APIs, architecture, integrations, or user flows.
