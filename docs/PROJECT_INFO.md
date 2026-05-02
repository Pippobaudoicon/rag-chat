# LDS rag-chat Project Knowledge Base

Last updated: 2026-05-02

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
- UUID conversation URLs and API identifiers.
- Semantic search endpoint (`/api/search`) for retrieval-only use cases.
- Tool-assisted answer refinement for:
  - scripture passage lookup
  - conference talk lookup with optional speaker/year constraints
  - citation index validation against current source list
- Visual tool-use feedback in chat responses (tool badges similar to major AI chats).

## 4) Runtime architecture flow

1. Client sends chat message to `POST /api/chat` with selected language/sources/topK.
2. Server verifies auth and extracts the latest user question.
3. Server does NOT pre-fetch context. Instead it constructs an AI SDK `streamText`
   call with the RAG tool set and lets the model decide how to retrieve.
4. The model calls one or more retrieval tools per turn as it sees fit:
   - `semantic_search` for general topical queries (caches via Upstash Redis).
   - `lookup_scripture_passage` for scripture references.
   - `search_conference_talks` for talks by title / speaker / year.
   Multiple tools (and repeated calls to the same tool with different
   arguments) are allowed when the question benefits from it.
5. Tool results register chunks in a shared per-turn `RagToolContext` so all
   citation indices remain stable across multiple tool calls.
6. The model generates the final answer and may call `citation_verifier`
   before completing.
7. LLM response is streamed back via AI SDK.
8. Assistant text + collected tool chunks are persisted to DB and returned as
   metadata. The Redis cache entry is updated with the final answer text.
9. UI renders message, inline citations, and source cards.

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
  - UUID primary key, owner (`clerk_user_id`), title, language, sources, timestamps.
- `rag_messages`
  - UUID conversation FK, integer message id, role (`user|assistant`), content,
    `sources_json`, timestamp.
- `rag_message_feedback`
  - UUID conversation FK, optional assistant message FK, owner, rating/comment,
    copied answer context, timestamp.

Notes:

- Assistant messages may include `sources_json` used by UI source panel.
- Conversation auto-title is derived from first user message.
- New conversations are inserted into the sidebar immediately with an optimistic
  client title. The sidebar waits to refetch until after the first assistant
  response, so the optimistic title is not overwritten by the just-created DB
  row that still has `title = null`.
- Sidebar conversation actions use a hover menu with rename and delete, and
  renames persist through `PATCH /api/conversations/[id]` while updating the
  local sidebar cache immediately.

## 7) Retrieval and prompting behavior

- Uses Pinecone index `lds-rag` and per-source namespaces.
- Filters retrieval by `language` metadata.
- Special scripture handling for whole chapter/book requests:
  - parses scripture references,
  - enforces chapter-oriented retrieval,
  - sorts by verse start,
  - boosts chapter coverage in returned chunks.
- Retrieval is **tool-driven** end-to-end. The chat route does not call
  `retrieve()` eagerly; the model decides which retrieval tools to invoke
  via the AI SDK tools API and may chain multiple tools per turn when the
  question benefits from it. This eliminates the previous double-retrieval
  (eager + tool) and lets the cache live entirely inside the
  `semantic_search` tool. `stopWhen: stepCountIs(8)` in the chat route caps
  the number of model + tool steps per turn.
- AI function tools available in the chat runtime:
  - `semantic_search` — general topical retrieval over the user's selected
    sources, with Upstash Redis caching.
  - `lookup_scripture_passage` — scripture-by-reference retrieval with strict
    book/chapter filtering.
  - `search_conference_talks` — conference-talk retrieval with optional
    speaker / year / title filters; uses strict speaker/year/title filtering
    first, retries title-focused query variants, and returns a
    title-not-found result instead of unrelated same-speaker talks when a
    requested title is not present in conference metadata.
  - `citation_verifier` — validates inline numeric citations against the
    chunks accumulated during the turn.
- Tool source code lives under `src/lib/rag/tools/`, one folder per tool plus
  a `shared/` folder for cross-cutting infrastructure (`tool-context.ts`,
  `chunk-formatting.ts`, `text-normalize.ts`). The package entry point is
  `src/lib/rag/tools/index.ts` which exposes `createRagTools()`.
- All tools share a per-turn `RagToolContext` so citation indices are stable
  across multiple tool calls. Persisted/UI source ordering matches the
  citation-verifier order: chunks are listed in the order they were first
  registered by tools.
- System prompt enforces:
  - tool-first retrieval (at least one retrieval tool for any substantive
    question; multiple tools allowed when justified),
  - same-language answers,
  - no unsupported claims,
  - no fabricated citations,
  - citation mapping to tool-returned chunks only,
  - include canonical links only when present in chunk metadata.

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
- `CHAT_MODEL` (optional; defaults to `deepseek/deepseek-v4-flash`)
- `CHAT_MAX_RESPONSE_SOURCES` (optional; defaults to 120)

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
  - `src/lib/rag/tools/index.ts` (factory)
  - `src/lib/rag/tools/shared/` (tool-context, chunk-formatting, text-normalize)
  - `src/lib/rag/tools/semantic-search/`
  - `src/lib/rag/tools/lookup-scripture-passage/`
  - `src/lib/rag/tools/search-conference-talks/`
  - `src/lib/rag/tools/citation-verifier/`
- DB:
  - `src/lib/db/schema.ts`
  - `src/lib/db/index.ts`
  - `drizzle.config.ts`

## 10) Known constraints and non-features

- Current generation model defaults to `deepseek/deepseek-v4-flash` and can be overridden with `CHAT_MODEL`.
- Embedding model must remain compatible with index dimensions.
- Chat route uses a limited recent history window for context size control.

## 11) Operations quick start

- Dev: `npm run dev`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Start: `npm run start`
- Generate migrations: `npm run db:generate`
- Apply migrations: `npm run db:migrate`
- Docs guard: `npm run docs:guard`

## 12) Update policy for agents

When changing architecture, behavior, integrations, API contracts, or major UX flow:

1. Update this file in the same change.
2. Update `AGENTS.md` if process instructions changed.
3. Run `npm run docs:guard`.

The goal is to make future agent sessions start from this document and avoid repeated
exploratory searching.
