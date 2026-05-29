# ChatLDS Project Knowledge Base

Last updated: 2026-05-29

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
- Billing: Clerk Billing for subscriptions; Stripe is used only for payment processing.
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
- Language selector: UI-only language preference. Current selectable UI languages are Italian, English, French, Spanish, Portuguese, and German; non-translated UI copy falls back to English.
- Inline numeric citations linked to source cards.
- Sources panel with scripture coverage behavior for chapter/book requests.
- Conversation CRUD in sidebar (create/list/open/delete) and title updates.
- UUID conversation URLs and API identifiers.
- Semantic search endpoint (`/api/search`) for retrieval-only use cases.
- Subscription-aware Free/Pro entitlements through Clerk Billing.
- Billing page with localized plan status, usage meters, and upgrade/manage actions.
- Free-plan warning banner in chat when the user approaches the chat request limit.
- Tool-assisted answer refinement for:
  - scripture passage lookup
  - conference talk lookup with optional speaker/year constraints
  - citation index validation against current source list
- Visual tool-use feedback in chat responses (tool badges similar to major AI chats).

## 4) Runtime architecture flow

1. Client sends chat message to `POST /api/chat` with selected UI language/sources/topK.
2. Server verifies auth and extracts the latest user question.
3. Server loads Clerk Billing entitlements, checks Clerk plan access via `auth().has({ plan })`, and applies plan-aware chat rate limits plus a `topK` cap.
4. Server detects the user's prompt language and translates the retrieval query into the configured Pinecone index language (`RAG_INDEX_LANGUAGE`, currently Italian by default).
5. Server does NOT pre-fetch context. Instead it constructs an AI SDK `streamText`
   call with the RAG tool set and lets the model decide how to retrieve.
6. The model calls one or more retrieval tools per turn as it sees fit, using the translated index-language search query:
   - `semantic_search` for general topical queries (caches via Upstash Redis).
   - `lookup_scripture_passage` for scripture references (also cached via Upstash Redis).
   - `search_conference_talks` for talks by title / speaker / year (also cached via Upstash Redis).
   Multiple tools (and repeated calls to the same tool with different
   arguments) are allowed when the question benefits from it.
7. Tool results register chunks in a shared per-turn `RagToolContext` so all
   citation indices remain stable across multiple tool calls.
8. The model generates the final answer in the original language of the user's prompt and may call `citation_verifier`
   before completing.
9. LLM response is streamed back via AI SDK.
10. For normal non-regenerate conversation turns, the chat route checks a
   session-scoped answer cache keyed by user, conversation, normalized question,
   turn settings, recent history, and memory context. Cache hits skip the full
   retrieval + model pipeline while still persisting the user/assistant messages.
11. Assistant text + collected tool chunks + tool names used during the turn are
   persisted to DB and returned as metadata. Redis cache entries are updated
   with retrieval outputs, session answer payloads, and sidebar title/list data.
12. UI renders message, inline citations, and source cards.

## 5) API surface (internal app API)

- `POST /api/chat`
  - Auth required.
  - Retrieval + generation + streaming.
  - Per-user, plan-aware Upstash Redis rate limiting.
  - Persists messages for existing/new conversation flow.
- `GET /api/search`
  - Auth required.
  - Retrieval only, no generation.
  - Plan-aware rate limiting and `topK` caps.
- `GET /api/billing/subscription`
  - Auth required.
  - Returns normalized Free/Pro entitlements from Clerk Billing plus Redis-backed usage snapshots.
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
    `sources_json`, `versions_json`, `details_json`, timestamp.
- `rag_message_feedback`
  - UUID conversation FK, optional assistant message FK, owner, rating/comment,
    copied answer context, timestamp.

Notes:

- Assistant messages may include `sources_json` used by UI source panel.
- Assistant `details_json` stores response details and the `toolNames` list so
  tool-use badges remain visible after reloading a conversation.
- Conversation auto-title is derived from first user message.
- Conversation titles are cached in Redis and the conversation list endpoint is
  cached per user/page cursor with invalidation on create, rename, delete, and
  chat activity that updates `updatedAt`.
- New conversations are inserted into the sidebar immediately with an optimistic
  client title. The sidebar waits to refetch until after the first assistant
  response, so the optimistic title is not overwritten by the just-created DB
  row that still has `title = null`.
- Sidebar conversation actions use a hover menu with rename and delete, and
  renames persist through `PATCH /api/conversations/[id]` while updating the
  local sidebar cache immediately.
- Sidebar conversations are grouped client-side by `updatedAt` into Recent,
  More than a week ago, and More than a month ago sections.

## 7) Retrieval and prompting behavior

- Uses Pinecone index `lds-rag` and per-source namespaces.
- The language selector controls only UI labels. It does not affect search language or final answer language.
- Each user prompt is language-detected, translated into the configured index language before Pinecone search, then answered in the original prompt language.
- `RAG_INDEX_LANGUAGE` controls the single-language retrieval target. It defaults to Italian (`ita`) for the current Pinecone corpus and can be switched to English (`eng`) after the index migration.
- Retrieval still preserves each chunk's source-language metadata; scripture sources can later add multilingual namespaces/chunks while other documents remain in one primary index language.
- Special scripture handling for whole chapter/book requests:
  - parses scripture references,
  - enforces chapter-oriented retrieval,
  - sorts by verse start,
  - boosts chapter coverage in returned chunks.
- Retrieval is **tool-driven** end-to-end. The chat route does not call
  `retrieve()` eagerly; the model decides which retrieval tools to invoke
  via the AI SDK tools API and may chain multiple tools per turn when the
  question benefits from it. This eliminates the previous double-retrieval
  (eager + tool). Retrieval caching now lives in the tool layer for
  `semantic_search`, `lookup_scripture_passage`, and
  `search_conference_talks`. `stopWhen: stepCountIs(8)` in the chat route caps
  the number of model + tool steps per turn.
- AI function tools available in the chat runtime:
  - `semantic_search` — general topical retrieval over the user's selected
    sources, with Upstash Redis caching.
  - `lookup_scripture_passage` — scripture-by-reference retrieval with strict
    book/chapter filtering, with Upstash Redis caching of retrieval results.
  - `search_conference_talks` — conference-talk retrieval with optional
    speaker / year / title filters; uses strict speaker/year/title filtering
    first, retries title-focused query variants, and returns a
    title-not-found result instead of unrelated same-speaker talks when a
    requested title is not present in conference metadata; retrieval results are
    cached in Upstash Redis.
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
  - same-language answers based on the user's latest question, independent from the selected UI language,
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
- `RAG_INDEX_LANGUAGE` (optional; defaults to `ita`; set to `eng` after the Pinecone index migration)
- `CHAT_MODEL` (optional; defaults to `deepseek/deepseek-v4-flash`)
- `CHAT_MAX_RESPONSE_SOURCES` (optional; defaults to 120)
- `CHAT_RATE_LIMIT_MAX_REQUESTS` (optional; defaults to 30)
- `CHAT_RATE_LIMIT_WINDOW` (optional; defaults to `1h`)
- `CLERK_BILLING_PRO_PLAN_ID` / `NEXT_PUBLIC_CLERK_BILLING_PRO_PLAN_ID` (optional explicit Clerk Pro plan ID)
- `CLERK_BILLING_PRO_PLAN_KEY` / `NEXT_PUBLIC_CLERK_BILLING_PRO_PLAN_KEY` (optional Clerk Pro plan key; defaults to `pro_user`)
- `CLERK_BILLING_PRO_PLAN_SLUG` / `NEXT_PUBLIC_CLERK_BILLING_PRO_PLAN_SLUG` (optional; defaults include `pro_user` and `pro`)
- `SUBSCRIPTION_RATE_LIMIT_WINDOW` (optional; defaults to `CHAT_RATE_LIMIT_WINDOW` or `1h`)
- `SUBSCRIPTION_PRO_CHAT_RATE_LIMIT` (optional; defaults to 300)
- `SUBSCRIPTION_FREE_SEARCH_RATE_LIMIT` (optional; defaults to 60)
- `SUBSCRIPTION_PRO_SEARCH_RATE_LIMIT` (optional; defaults to 600)
- `SUBSCRIPTION_FREE_MAX_TOP_K` (optional; defaults to 10)
- `SUBSCRIPTION_PRO_MAX_TOP_K` (optional; defaults to 20)

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
  - `src/app/api/billing/subscription/route.ts`
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
- Billing:
  - `src/lib/billing/entitlements.ts`
  - `src/lib/billing/usage.ts`
  - `src/app/(app)/billing/page.tsx`
  - `src/components/billing/BillingPageClient.tsx`
  - `src/components/billing/BillingActions.tsx`

## 10) Known constraints and non-features

- Current generation model defaults to `deepseek/deepseek-v4-flash` and can be overridden with `CHAT_MODEL`.
- Clerk Billing is the subscription source of truth. Clerk Billing Plans and Subscriptions are not synced to Stripe; Stripe is only the payment processor. The default Pro plan key is `pro_user`.
- Clerk Billing is beta/experimental, so `@clerk/nextjs` is pinned in `package.json` instead of using a semver range.
- Clerk's subscription detail API is best-effort. If user billing is not enabled in the Clerk instance, the app falls back to Free entitlements without logging noisy expected 403 errors.
- Chat and search usage display uses Redis sorted-set counters keyed per user and rolling window. If Redis is unavailable, enforcement and usage display gracefully degrade.
- Embedding model must remain compatible with index dimensions.
- Chat route uses a limited recent history window for context size control.
- Current Pinecone search language defaults to Italian until `RAG_INDEX_LANGUAGE` is changed during the future English-index migration.

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
