# LDS rag-chat Project Knowledge Base

Last updated: 2026-04-06

This document is the single source of truth for project context.
Read this first before deep code exploration.

## 1) What this app is

- A Next.js app that provides LDS-focused RAG chat.
- It is authenticated (Clerk), stores conversation history (Postgres via Drizzle),
  retrieves context from Pinecone, and generates responses via AI SDK.
- It is independent from the Python backend in `hymns/`, but intentionally mirrors
  key behavior (prompting and retrieval conventions) for consistency.

## 2) Current stack

- Framework/UI: Next.js 16, React 19, Tailwind 4.
- Auth: Clerk.
- DB: Neon Postgres + Drizzle ORM.
- Vector DB: Pinecone.
- Embeddings: Voyage AI (`voyage-4-large`, 1024 dims).
- LLM runtime: Vercel AI SDK (`streamText`) through gateway.
- Cache: Upstash Redis.
- Observability: Vercel Analytics + Speed Insights.

## 3) User-facing capabilities

- Multi-turn chat with persisted conversation history.
- Source filters:
  - Scriptures
  - Conference
  - Handbook
  - Liahona
- Language switch: Italian (`ita`) and English (`eng`).
- Inline numeric citations linked to source cards.
- Sources panel with scripture coverage behavior for chapter/book requests.
- Conversation CRUD in sidebar (create/list/open/delete) and title updates.
- Semantic search endpoint (`/api/search`) for retrieval-only use cases.
- Tool-assisted answer refinement for:
  - scripture passage lookup
  - conference talk lookup with optional speaker/year constraints

## 4) Runtime architecture flow

1. Client sends chat message to `POST /api/chat` with selected language/sources/topK.
2. Server verifies auth, extracts latest user question, and checks Redis cache.
3. If needed, server embeds query with Voyage AI and retrieves from Pinecone namespaces.
4. Retrieved chunks are formatted and injected into the final user turn.
5. LLM response is streamed back via AI SDK.
6. Assistant text + source chunks are persisted to DB and returned as metadata.
7. UI renders message, inline citations, and source cards.

## 5) API surface (internal app API)

- `POST /api/chat`
  - Auth required.
  - Retrieval + generation + streaming.
  - Persists messages for existing/new conversation flow.
- `GET /api/search`
  - Auth required.
  - Retrieval only, no generation.
- `GET /api/conversations`
  - List user conversations (latest first).
- `POST /api/conversations`
  - Create conversation with language/sources defaults.
- `GET /api/conversations/[id]`
  - Fetch conversation with full messages.
- `PATCH /api/conversations/[id]`
  - Rename conversation.
- `DELETE /api/conversations/[id]`
  - Delete conversation and cascading messages.

## 6) Data model summary

- `rag_conversations`
  - owner (`clerk_user_id`), title, language, sources, timestamps.
- `rag_messages`
  - conversation FK, role (`user|assistant`), content, `sources_json`, timestamp.

Notes:

- Assistant messages may include `sources_json` used by UI source panel.
- Conversation auto-title is derived from first user message.

## 7) Retrieval and prompting behavior

- Uses Pinecone index `lds-rag` and per-source namespaces.
- Filters retrieval by `language` metadata.
- Special scripture handling for whole chapter/book requests:
  - parses scripture references,
  - enforces chapter-oriented retrieval,
  - sorts by verse start,
  - boosts chapter coverage in returned chunks.
- Chat runtime also exposes AI function tools for targeted retrieval:
  - `lookup_scripture_passage`
  - `search_conference_talks`
- System prompt enforces:
  - same-language answers,
  - no unsupported claims,
  - no fabricated citations,
  - citation mapping to provided chunks only,
  - include canonical links only when present.

## 8) Environment variables

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
- `DATABASE_URL`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `VOYAGE_API_KEY`
- `PINECONE_API_KEY`

Reference template: `.env.example`.

## 9) Directory map (high signal files)

- App shell/layout:
  - `src/app/layout.tsx`
  - `src/app/(app)/layout.tsx`
  - `src/components/layout/AppShell.tsx`
- Chat UI and controls:
  - `src/components/chat/ChatInterface.tsx`
  - `src/components/chat/SettingsPanel.tsx`
  - `src/components/chat/SourcesPanel.tsx`
  - `src/components/chat/ChatSidebar.tsx`
- API routes:
  - `src/app/api/chat/route.ts`
  - `src/app/api/search/route.ts`
  - `src/app/api/conversations/route.ts`
  - `src/app/api/conversations/[id]/route.ts`
- RAG internals:
  - `src/lib/rag/system-prompt.ts`
  - `src/lib/rag/retriever.ts`
  - `src/lib/rag/embedder.ts`
  - `src/lib/rag/cache.ts`
  - `src/lib/rag/scripture-reference.ts`
  - `src/lib/rag/citation-links.ts`
- DB:
  - `src/lib/db/schema.ts`
  - `src/lib/db/index.ts`
  - `drizzle.config.ts`

## 10) Known constraints and non-features

- Current generation model is pinned in code (`openai/gpt-4o-mini`).
- Embedding model must remain compatible with index dimensions.
- Chat route uses a limited recent history window for context size control.

## 11) Operations quick start

- Dev: `npm run dev`
- Build: `npm run build`
- Start: `npm run start`
- Docs guard: `npm run docs:guard`

## 12) Update policy for agents

When changing architecture, behavior, integrations, API contracts, or major UX flow:

1. Update this file in the same change.
2. Update `AGENTS.md` if process instructions changed.
3. Run `npm run docs:guard`.

The goal is to make future agent sessions start from this document and avoid repeated
exploratory searching.
