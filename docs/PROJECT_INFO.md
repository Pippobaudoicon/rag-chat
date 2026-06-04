# ChatLDS Project Knowledge Base

Last updated: 2026-06-03

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
- Source filters (individual toggles):
  - Scriptures
  - Conference
  - Handbook
  - Study Helps (Bible Dictionary, Guide to the Scriptures, JST; Topical Guide is graph-only, not retrievable)
  - Topics
  - plus a "Super" toggle exposing all Pinecone namespaces
- Language selector: UI-only language preference. Current selectable UI languages are Italian, English, French, Spanish, Portuguese, and German; non-translated UI copy falls back to English.
- Inline numeric citations linked to source cards.
- Sources panel with scripture coverage behavior for chapter/book requests.
- Conversation CRUD in sidebar (create/list/open/delete) and title updates.
- UUID conversation URLs and API identifiers.
- Semantic search endpoint (`/api/search`) for retrieval-only use cases.
- Dedicated semantic search page (`/search`) for authenticated retrieval-only source inspection.
- Subscription-aware Free/Pro entitlements through Clerk Billing.
- Billing page with localized plan status, usage meters, and upgrade/manage actions.
- Dedicated memory page (`/memory`) for authenticated users to review and refresh saved personalization memory.
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
4. Server detects the user's prompt language and translates the retrieval query into the configured Pinecone index language (`RAG_INDEX_LANGUAGE`, English by default for `lds-rag-v1`).
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
10. The chat route loads a compact personalization memory brief by default,
   plus a memory version signature for cache invalidation. The full saved
   memory is available only through the `read_personal_memory` tool when the
   model decides the current turn needs it.
11. For normal non-regenerate conversation turns, the chat route checks a
   session-scoped answer cache keyed by user, conversation, normalized question,
   turn settings, recent history, and memory signature. Cache hits skip the full
   retrieval + model pipeline while still persisting the user/assistant messages.
12. Assistant text + collected tool chunks + tool names used during the turn are
   persisted to DB and returned as metadata. Redis cache entries are updated
   with retrieval outputs, session answer payloads, and sidebar title/list data.
13. UI renders message, inline citations, and source cards.

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
- `GET /api/memory`
  - Auth required.
  - Returns the current user's saved profile memory, weekly/monthly rollups, and recent-conversation memory.
- `POST /api/memory`
  - Auth required.
  - Refreshes recent-conversation memory and period rollups, then returns the updated memory snapshot.
- `GET /api/conversations`
  - List user conversations (latest first).
- `POST /api/conversations`
  - Create conversation with language/sources defaults and an optional
    `responseStyle` override.
- `GET /api/conversations/[id]`
  - Fetch conversation with full messages.
- `PATCH /api/conversations/[id]`
  - Rename conversation and/or set its `responseStyle` override (at least one
    field required).
- `DELETE /api/conversations/[id]`
  - Delete conversation and cascading messages.
- `GET /api/settings`
  - Auth required. Returns the user's persistent preferences (currently
    `defaultResponseStyle`).
- `PUT /api/settings`
  - Auth required. Updates the user's default response style.

## 6) Data model summary

- `rag_conversations`
  - UUID primary key, owner (`clerk_user_id`), title, language, sources,
    `response_style` (nullable per-conversation override), timestamps.
- `rag_messages`
  - UUID conversation FK, integer message id, role (`user|assistant`), content,
    `sources_json`, `versions_json`, `details_json`, timestamp.
- `rag_message_feedback`
  - UUID conversation FK, optional assistant message FK, owner, rating/comment,
    copied answer context, timestamp.
- `rag_user_settings`
  - Owner (`clerk_user_id`) primary key, `default_response_style`, timestamps.
    Persistent per-user preferences, kept separate from the memory-profile
    tables so background profiling can never clobber a settings change.

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

- Uses Pinecone index `lds-rag-v1` (override via `PINECONE_INDEX`) and per-source
  namespaces. v1 namespaces: scriptures, conference, handbook, study_helps,
  gospel_topics, gospel_selfreliance, gospel_teachings, gospel_other, gospel_study,
  gospel_history, gospel_youth (plus gospel_music kept as a planned-but-empty
  namespace). Legacy namespaces liahona / gospel_family / gospel_videos /
  gospel_handbook were retired (gospel_handbook content now lives under handbook).
  Vectors carry a `related_ids` cross-reference projection from the graph.
  Both `lookup_scripture_passage` and `semantic_search` consume it via the shared
  `expandRelatedContext` helper: after retrieval they fetch the results'
  `related_ids` by id (cross-referenced verses + Bible Dictionary / Guide to the
  Scriptures study-help entries) and attach them as supporting context for fuller,
  scholar-grade answers. The scripture tool expands from every passage chunk (cap
  24); `semantic_search` is conservative — it seeds only from the strongest hits
  (top 4), caps the total (8), and keeps related context within the user's
  selected source filters.
  After expansion, results are **graph-reranked** (`tools/shared/graph-rerank.ts`):
  a chunk cross-referenced by several others in the retrieved neighborhood is
  central to the topic and gets a small, capped score boost. This is multi-hop
  (expanded chunks carry their own `related_ids`) and uses only the in-Pinecone
  edges — the 60MB `cross_references.jsonl` sidecar is never shipped to the
  runtime. `semantic_search` reranks the whole set; `lookup_scripture_passage`
  pins the requested passage and reranks only the supporting context.
  NOTE: `related_ids` are projected only onto English chunks (the graph is built
  from English footnotes), so Italian scripture chunks have none until a
  scraper-side cross-language projection + re-ingest. Full-graph authority signals
  (e.g. TG-hub co-citation) remain a future offline metadata enhancement.
  (The earlier scripture-reference language leak — Italian chunks surfacing for
  English reference lookups — was fixed in 0.9.1 via slug-based book matching.)
- The language selector controls only UI labels. It does not affect search language or final answer language.
- Each user prompt is language-detected, translated into the configured index language before Pinecone search, then answered in the original prompt language.
- `RAG_INDEX_LANGUAGE` controls the single-language retrieval target. It defaults to English (`eng`) for `lds-rag-v1` (English-main corpus; scriptures also carry Italian chunks). Set to `ita` only to target the legacy `lds-rag` index.
- Retrieval still preserves each chunk's source-language metadata. Scriptures are bilingual (eng+ita); scripture verse/chapter retrieval **prefers the answer language** (queries it first, falls back to the other indexed language only if empty), so an English question returns English scripture. Other namespaces are English-only.
- Structured scripture retrieval (verse + chapter, including bare chapter refs like "Alma 32") filters Pinecone on **language-invariant** signals (`language` + `chapter`) and enforces the requested book via its **slug** (chunk id 3rd segment `scriptures:<lang>:<bookSlug>:…` / URL path), NOT the display book name. This is deliberate: `parseScriptureSelection().canonicalBook` is Italian (legacy table — "Giovanni", "Salmi", "2 Nefi") and does not match the English `book` metadata, so a `book: { $eq }` filter would silently return nothing and fall back to Italian or to unfiltered semantic results. (If the canonicalBook table is ever localized to English, the slug-based matching still holds.)
- Enrichment metadata is consumed (present on enriched namespaces — scriptures + conference): the retriever maps `summary`, `topics`, `entities` (people/places/doctrines), and `references` onto each chunk. These are (a) sent to the model as per-source context via `toToolChunk` (context only — not citable sources), (b) shown as tags/reference chips on source cards, and (c) used for a small, capped topic/entity rerank boost when query terms overlap a chunk's topics/entities.
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
    book/chapter (slug-based) filtering. Then expands the passage with its
    cross-reference graph (`related_ids`): cited passages + Bible Dictionary /
    Guide to the Scriptures entries, attached as supporting context (capped) for
    scholar-grade answers. Upstash Redis caches the **neutral, pre-rerank**
    `{ passage, related }` split; the flag-dependent graph rerank is applied after
    the cache read so toggling `RAG_GRAPH_RERANK` is honored on cache hits (same
    pattern as `semantic_search`).
  - `search_conference_talks` — conference-talk retrieval with optional
    speaker / year / title filters; uses strict speaker/year/title filtering
    first, retries title-focused query variants, and returns a
    title-not-found result instead of unrelated same-speaker talks when a
    requested title is not present in conference metadata; retrieval results are
    cached in Upstash Redis.
  - `citation_verifier` — validates inline numeric citations against the
    chunks accumulated during the turn.
  - `read_personal_memory` — reads the user's full saved personalization memory
    on demand when the compact memory brief is insufficient for the current turn.
  - `update_personal_memory` — stores durable personalization memory only when
    the user explicitly asks to remember something or provides stable preferences,
    facts, recurring goals, or durable feedback.
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
  - automatic use of retrieved cross-references, study-help entries, enrichment
    metadata, and related chunks when they improve the answer, without requiring
    the user to ask for "useful cross-references",
  - same-language answers based on the user's latest question, independent from the selected UI language,
  - no unsupported claims,
  - no fabricated citations,
  - citation mapping to tool-returned chunks only,
  - include canonical links only when present in chunk metadata.
  - religious-scholar depth with clear, plain explanations suitable for adults,
    youth, and new learners.
- The system prompt is composed from a constant CORE (identity + the retrieval,
  grounding, citation, and memory rules above) plus a swappable **response-style**
  block that controls only voice/altitude — never grounding or citations.
  `system-prompt.ts` exports `RESPONSE_STYLES` (`balanced` | `scholar` | `simple`
  | `concise`), `DEFAULT_RESPONSE_STYLE` (`balanced`), and
  `buildSystemPrompt(styleId)`. `SYSTEM_PROMPT` = `buildSystemPrompt(default)`.
  The default "Balanced" style encodes an operational readability contract:
  scholar-level depth in the substance, child-followable wording, define-on-first-
  use for doctrinal terms, and a child-and-scholar dual self-check.
- **Style resolution** (chat route): effective style =
  conversation `response_style` override → user `default_response_style`
  (`rag_user_settings`, via `getUserPreferences`) → `DEFAULT_RESPONSE_STYLE`
  (`balanced`). The client sends `responseStyle` only for an explicit
  per-conversation override; the chat route persists that override and calls
  `buildSystemPrompt(effectiveStyle)`. The settings bar (`SettingsPanel`) exposes
  the 4 styles plus a "set as default" action (`PUT /api/settings`); changing the
  style mid-conversation persists via `PATCH /api/conversations/[id]`.

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
- `PINECONE_INDEX` (optional; defaults to `lds-rag-v1`; set to `lds-rag` for the legacy index)
- `RAG_INDEX_LANGUAGE` (optional; defaults to `eng` for `lds-rag-v1`; set to `ita` for the legacy index)
- `CHAT_MODEL` (optional; defaults to `deepseek/deepseek-v4-flash`)
- `CHAT_MEMORY_ENABLED` (optional; set to `false` to disable chat personalization memory)
- `CHAT_MEMORY_BRIEF_CHARS` (optional; defaults to 700; caps the compact memory brief injected into each chat request)
- `CHAT_MEMORY_CONTEXT_CHARS` (optional; defaults to 3500; caps full memory context available through the memory read tool)
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
- Search UI:
  - `src/app/(app)/search/page.tsx`
  - `src/components/search/SearchPageClient.tsx`
- Memory UI:
  - `src/app/(app)/memory/page.tsx`
  - `src/components/memory/MemoryPageClient.tsx`
- API routes:
  - `src/app/api/chat/route.ts`
  - `src/app/api/search/route.ts`
  - `src/app/api/billing/subscription/route.ts`
  - `src/app/api/conversations/route.ts`
  - `src/app/api/conversations/[id]/route.ts`
  - `src/app/api/settings/route.ts` (per-user default response style)
- User settings:
  - `src/lib/db/user-settings.ts` (read/write `rag_user_settings`)
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
- Pinecone search language defaults to English (`lds-rag-v1`). Scriptures retrieve in both English and Italian; all other namespaces are English-only.

## 11) Operations quick start

- Dev: `npm run dev`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Start: `npm run start`
- Generate migrations: `npm run db:generate`
- Apply migrations: `npm run db:migrate`
- Docs guard: `npm run docs:guard`
- Retrieval eval: `npm run eval` (golden set in `scripts/eval/dataset.ts`; reports
  MRR/recall/structural checks with graph-rerank off vs on; writes JSON to
  `scripts/eval/results/`). Hits live Pinecone + Voyage. Add a filter:
  `npm run eval -- faith`.

### Feature flags
- `RAG_GRAPH_RERANK` (default **on**) — graph-aware reranking (`src/lib/rag/flags.ts`).
  Enabled by default (eval shows it improves ranking with no regressions); set to
  `false` as a kill-switch. The eval harness toggles rerank directly, independent
  of this flag.

## 12) Update policy for agents

When changing architecture, behavior, integrations, API contracts, or major UX flow:

1. Update this file in the same change.
2. Update `AGENTS.md` if process instructions changed.
3. Run `npm run docs:guard`.

The goal is to make future agent sessions start from this document and avoid repeated
exploratory searching.
