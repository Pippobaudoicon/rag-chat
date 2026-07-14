# ChatLDS Project Knowledge Base

Last updated: 2026-07-14

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
- Cache and resumable stream transport: Upstash Redis REST plus
  `resumable-stream/generic` (status-polling fallback when Redis is absent).
- Observability: Vercel Analytics + Speed Insights.

## 3) User-facing capabilities

- Multi-turn chat with persisted conversation history.
- Navigation-safe generation: the first submitted message is persisted before
  generation, active work is visible in the sidebar, and returning to a
  conversation resumes its Redis-backed stream or reloads the completed result.
- Search-scope toggle (chat composer, replaces the old per-source toggles):
  - `Standard` — sends `ALL_SOURCES` (scriptures, conference, handbook, study_helps, topics); the model may narrow *within* this scope.
  - `Super` — sends `SUPER_SOURCES` (every Pinecone namespace). Persisted to `localStorage` under `chat:search-scope`.
  - The `/search` console keeps the full per-source `SettingsPanel` for debugging.
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

1. Opening `/chat` or the sidebar does **not** create a database row. On the first
   non-empty submit, the client calls `POST /api/conversations` with `title` and
   `initialMessage`; one batched operation atomically stores the owned conversation
   and first user message, marks the row as pending (`streaming` with no active
   turn id), and returns the conversation plus `initialMessageId`.
2. The client immediately exposes that conversation in the sidebar, switches the
   URL to `/chat/[id]`, and calls `POST /api/chat` with the same user content,
   `conversationId`, and `persistedUserMessageId`.
3. The chat route verifies auth, extracts the latest user question, loads Clerk
   Billing entitlements, checks Clerk plan access via `auth().has({ plan })`, and
   applies plan-aware chat rate limits plus a `topK` cap. These auth/ratelimit gates
   resolve first so a rejected request never pays for model/retrieval work; a rejected
   pending first turn is moved to `error` instead of remaining active.
4. The conversation **ownership gate** is a single indexed lookup (404 on a
   deleted/unowned id). When `persistedUserMessageId` is supplied, the stored row
   must be the current tail user message in that conversation and its content must
   match the submitted question; it is excluded from model history and is not
   inserted a second time. Old or already-completed message ids cannot be replayed.
   Once past the gate, mutually independent reads run concurrently: messages, the
   memory brief, and user preferences. There is no answer-language or translation
   model call in the preamble.
5. The main chat model infers the answer language directly from the original user message. TinyLD does not supply an answer-language hint or scripture-language preference. During the same tool-decision step, the model translates `semantic_search` and `search_conference_talks` query/title arguments into the corpus language stated in each tool description, while preserving names and references. Both `semantic_search` and `lookup_scripture_passage` require the model to select the prompt's indexed scripture language (`"ita"` or `"eng"`; English fallback for unsupported languages). `RagToolContext` locks the first selection across the whole turn, and semantic retrieval filters primary, related, and cached chunks, so scripture source cards can never mix languages. `RAG_LANGUAGE_ROUTING` defaults to `false`; setting it to `true` restores the legacy per-tool dedicated routing model.
6. Server constructs an AI SDK `streamText` call with the RAG tool set and lets the model decide how to retrieve.
7. **Eager retrieval (P1, flag-gated, default OFF — opt-in):** on an answer-cache miss, for a high-confidence same-language topical question the server can run the default `semantic_search` retrieval during the preamble and seed the chunks into the user message. Its TinyLD check is only an eager-retrieval safety gate; it never controls answer or scripture language.
8. The model calls retrieval tools and supplies corpus-ready arguments in the same step:
   - `semantic_search` for general topical queries (caches via Upstash Redis).
   - `lookup_scripture_passage` for scripture references (also cached via Upstash Redis).
   - `search_conference_talks` for talks by title / speaker / year (also cached via Upstash Redis).
   A turn permits one retrieval round with at most two retrieval executions;
   genuinely multi-source questions may call two tools together in that round.
   Afterward only optional citation verification remains available before the
   final answer.
9. Tool results register chunks in a shared per-turn `RagToolContext` so all
   citation indices remain stable across multiple tool calls.
10. The model generates the final answer in the original language of the user's prompt and may call `citation_verifier`
   before completing.
11. Before generation starts, the route claims the conversation with an atomic
   compare-and-set: a pending first row (`streaming` + null `active_turn_id`) or a
   terminal/idle row receives a unique `active_turn_id`, optional Redis
   `active_stream_id`, and fresh `generation_started_at`. A second active request
   gets `409`; only the matching active turn may later commit its result.
12. The LLM response is streamed through AI SDK. With Upstash REST configured,
   `resumable-stream/generic` publishes the SSE stream and a returning client uses
   `GET /api/chat/[id]/stream` to resume it. The producer continues after the
   original browser disconnects.
13. Without Redis stream resume, the server consumes the stream in a Next.js
   `after()` task so generation can continue while that function remains alive.
   Clients poll `GET /api/conversations/[id]?status=1` and reload persisted messages
   when the status stops being `streaming`; partial tokens cannot be replayed.
14. The chat route loads a compact personalization memory brief by default,
   plus a memory version signature for cache invalidation. The full saved
   memory is available only through the `read_personal_memory` tool when the
   model decides the current turn needs it.
15. For normal non-regenerate conversation turns, the chat route checks a
   session-scoped answer cache keyed by user, conversation, normalized question,
   turn settings, recent history, and memory signature. Cache hits skip the full
   retrieval + model pipeline while still persisting the user/assistant messages.
16. Assistant text + collected tool chunks + tool names used during the turn are
   persisted to DB and returned as metadata. The owning turn changes generation
   status to `complete` (or `error`) and clears the active ids/timestamp. Redis
   cache entries are updated with retrieval outputs, session answer payloads, and
   sidebar title/list data.
17. UI renders message, inline citations, and source cards. Conversation-level
   polling plus the sidebar spinner keep in-progress work visible across route or
   conversation changes.

## 5) API surface (internal app API)

- `POST /api/chat`
  - Auth required.
  - Retrieval + generation + streaming.
  - Per-user, plan-aware Upstash Redis rate limiting.
  - Accepts an owned `conversationId` and optional `persistedUserMessageId`.
    When that id is present, it must be the matching tail user row for the current
    turn; the route reuses it instead of inserting a duplicate.
  - Claims persisted generation ownership before streaming, returns `409` while
    another non-stale turn is active, and commits only for the owning turn.
- `GET /api/chat/[id]/stream`
  - Auth and conversation ownership required.
  - Resumes the current SSE stream through `resumable-stream/generic` when
    Upstash REST is configured; returns `204` when no stream is resumable.
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
  - Auth required. **Pro-only**: free users get `403` with `{ upgradeUrl: "/billing" }`.
    Free-tier memory still refreshes automatically via the cron job; only the
    manual (spam-prone) trigger is gated.
  - Refreshes recent-conversation memory and period rollups, then returns the updated memory snapshot.
- `GET /api/conversations`
  - List user conversations (latest first), including `generationStatus` for
    sidebar activity indicators.
- `POST /api/conversations`
  - Creates a conversation with language/sources defaults plus optional
    `responseStyle`, `title`, and `initialMessage`.
  - When `initialMessage` is present, the conversation and first user message are
    written atomically in one batch and exposed immediately as pending work; the
    `201` response includes `initialMessageId`.
- `GET /api/conversations/[id]`
  - Fetch conversation with full messages.
  - `?status=1` returns only `{ id, generationStatus, updatedAt }` with `no-store`
    for lightweight polling. An unclaimed first turn older than 30 seconds, or a
    claimed generation older than four minutes, is recovered from `streaming` to
    `error` before the response.
- `PATCH /api/conversations/[id]`
  - Rename conversation and/or set its `responseStyle` override (at least one
    field required).
- `DELETE /api/conversations/[id]`
  - Delete conversation and cascading messages.
- `GET /api/settings`
  - Auth required. Returns the user's persistent preferences
    (`defaultResponseStyle`, `onboardingStatus`, `onboardingStep`).
- `PUT /api/settings`
  - Auth required. Updates whichever preferences are present (default response
    style and/or onboarding tour state); at least one field is required.

## 6) Data model summary

- `rag_conversations`
  - UUID primary key, owner (`clerk_user_id`), title, language, sources,
    `response_style` (nullable per-conversation override), timestamps.
  - Generation lifecycle: `generation_status`
    (`idle|streaming|complete|error`, default `idle`), nullable
    `active_turn_id`, nullable `active_stream_id`, and nullable
    `generation_started_at`. Added by migration `0010_sad_pestilence.sql`.
- `rag_messages`
  - UUID conversation FK, integer message id, role (`user|assistant`), content,
    `sources_json`, `versions_json`, `details_json`, timestamp.
- `rag_message_feedback`
  - UUID conversation FK, optional assistant message FK, owner, rating/comment,
    copied answer context, timestamp.
- `rag_user_settings`
  - Owner (`clerk_user_id`) primary key, `default_response_style`,
    `onboarding_status` (`pending|completed|skipped`), `onboarding_step`
    (resume point), timestamps. Persistent per-user preferences, kept separate
    from the memory-profile tables so background profiling can never clobber a
    settings change.

Notes:

- Assistant messages may include `sources_json` used by UI source panel.
- Assistant `details_json` stores response details and the `toolNames` list so
  tool-use badges remain visible after reloading a conversation. It also stores a
  `retrieval` trace (`RetrievalTrace`): index language, source filters, topK,
  the retrieval-flag signature, and per-tool
  stats (`RetrievalToolEvent`: sourceCount / cacheHit / elapsedMs, plus tool-local
  language routing — `routingMs` / `translated` / `inputLanguageCode` /
  `retrievalLanguage` / `routingModel` / `routingFallbackUsed` / `routingCalls` —
  present for `semantic_search` & `search_conference_talks`, absent for the
  non-translating `lookup_scripture_passage`). `search_conference_talks` may route
  two fields (query + title), so the telemetry is **aggregated** across both
  resolutions: `routingMs` summed, `translated`/`routingFallbackUsed` OR'd,
  `routingCalls` = number of model-invoking resolutions, `routingModel` = the
  distinct model(s) used. There is no longer a single global translated
  search query; translation is per-tool. The retrieved chunks live in
  `sources_json`; the trace captures the *how* so real conversations can be mined
  into the eval gold set.
- Assistant `details_json` also stores a versioned `latency` trace
  (`LatencyTrace` in `types.ts`) for quantifying chat-response latency from real
  traffic. It records independent pre-stream phase durations (auth, entitlements,
  ratelimit, convLoad, messagesLoad, routing, memoryBrief, answerCacheLookup,
  userMsgInsert, prefs), ordered milestones (`preStreamMs`, `firstModelChunkMs`,
  `firstToolCallMs`, `serverFirstTextMs`, `answerReadyMs` — generation/cache
  resolved, captured before the trailing DB/cache writes, so not total handler
  time), per-step **inclusive** wall time (`steps[].wallMs` covers model + any
  in-step tool execution, since `onStepFinish` fires after tools run), and
  per-tool `{name, durationMs, ok, cacheHit}`. The empty tool-decision turn is
  derived as `firstToolCallMs − preStreamMs` (not the gap from `firstToolCallMs`
  to `serverFirstTextMs`, which is retrieval plus later model/verifier work).
  `path` (`generated` |
  `answer-cache` | `regenerate`) separates cache-hit returns from cold-path
  percentiles, and `release` (`VERCEL_GIT_COMMIT_SHA`) enables before/after
  comparison. Built by `src/lib/observability/latency.ts` (`createLatencyTrace`
  for independent `performance.now()` durations + `withToolTiming` to wrap the
  tool set). Written on completed responses only (failed/aborted requests are
  absent), so derived percentiles are an optimization baseline, not an SLO.
  `serverFirstTextMs` is the server's first emitted text after `smoothStream`,
  not browser first paint.
- Conversation auto-title is derived from the first user message.
- Conversation titles are cached in Redis and the conversation list endpoint is
  cached per user/page cursor with invalidation on create, rename, delete, and
  chat activity that updates `updatedAt`.
- A blank `/chat` view does not create an empty conversation merely because the
  sidebar opened. The first non-empty submit creates it, persists the initial user
  message before generation, inserts it into the sidebar immediately as pending,
  and starts the owned generation using the returned `initialMessageId`.
- Sidebar rows include persisted generation status. Active rows display a spinner
  and the sidebar polls while any row is `streaming`; an open conversation also
  polls its lightweight status endpoint and either resumes the Redis stream or
  reloads the persisted completed/error state. First-page polling preserves any
  additional conversation pages the user already loaded.
- A failed conversation pre-create restores the local draft. Transport/claim
  failures have bounded recovery, and server-owned work uses a non-interactive
  composer progress indicator instead of implying that a local Stop cancels it.
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
- **Optional ranking stack in `retrieve()`** (semantic fan-out path only; the
  structured scripture verse/chapter short-circuits are untouched). Three
  independent, flag-gated, default-OFF stages:
  - **Multi-query expansion** (`RAG_MULTI_QUERY`, `query-expansion.ts`): an LLM
    generates up to 2 alternative phrasings (canonical LDS wording + plainer
    rewording) that are embedded alongside the original and fanned out across the
    namespaces, then merged/deduped — lifting recall before reranking.
  - **Cross-encoder rerank** (`RAG_RERANK`, `reranker.ts`): the merged candidate
    pool is scored against the query by Voyage `rerank-2.5`. Because a cross-encoder
    scores every candidate directly, its scores ARE comparable across namespaces/
    languages (unlike raw Pinecone cosine, where a 0.62 in `conference` is not worth
    a 0.62 in `gospel_study`). The relevance score becomes the primary sort key; the
    topic/entity boost and language tiebreak remain small secondary nudges. Fails
    open: on any API error it keeps the input order. This is distinct from the
    in-Pinecone **graph** rerank above (which runs later, in the tools).
  - **Diversity caps** (`RAG_MMR`): per-source (max 6) and per-title/talk (max 3)
    caps applied to the sorted top-k so one namespace or talk cannot crowd out
    complementary evidence; over-cap chunks spill to the end and can still backfill.
  - `retrieve()` accepts a `RetrieveOptions` override (`{ rerank, diversity,
    multiQuery }`) so the eval harness can force a stage on/off independent of env.
  - The reranker ranks the **globally strongest** candidates (the pool is sorted
    before the 100-candidate cap) and demotes any unreranked tail below all
    reranked chunks (cosine and Voyage relevance are different scales).
  - Retrieval/answer **cache keys include `retrievalFlagsSignature()`** so toggling
    language routing or ranking flags is not masked by a stale cache (graph rerank
    excluded — it runs after the cache read in the tools).
- The language selector controls only UI labels. It does not affect search language or final answer language.
- In chat, the main model emits corpus-language semantic/conference queries as part of its existing tool call and infers answer language directly from the original prompt. The optional legacy resolver remains behind `RAG_LANGUAGE_ROUTING=true`. `GET /api/search` still uses `routeQueryLanguage()`; with routing disabled it sends the original query unchanged.
- `RAG_INDEX_LANGUAGE` controls the single-language semantic retrieval target. It defaults to English (`eng`) for `lds-rag-v1` (English-main corpus; scriptures also carry Italian chunks). Set to `ita` only to target the legacy `lds-rag` index.
- Retrieval preserves source-language metadata. Scriptures are bilingual; the main model selects `"ita"` or `"eng"` for every scripture-producing tool. A per-turn lock forces all tools to the same selection, semantic fan-out queries only that scripture language, and post-expansion filtering removes any opposite-language scripture chunk. Production callers disable cross-language scripture fallback: an empty result is returned instead of showing scriptures in the wrong language. Other namespaces remain in their indexed corpus languages.
- **Cross-language de-duplication (topical fan-out).** The general `retrieve` path fans each query across every indexed language for recall, so bilingual content (scriptures, translated talks) came back twice — e.g. *Exodus 18* (eng) **and** *Esodo 18* (ita) — since `mergeChunks` only dedupes by exact id (which differs by language segment). After `mergeChunks`, `collapseCrossLanguage()` groups chunks by their **language-invariant id** (namespace + slug/chapter/verse, dropping the language segment) and keeps one per group: the answer-language copy at the group's best score (rank preserved). This runs before rerank/diversify/slice so the top-k holds distinct passages, not translation pairs. Passages present in only one language, or chunked into different verse ranges across languages, have no partner and pass through. (Verse/chapter-selection paths already pick a single language via `retrievePreferredLanguage`, so they are unaffected.) Regression: `npm run test:cross-language`.
- **Single-language direct-passage contract.** `lookup_scripture_passage` returns one language. The cross-reference graph's `related_ids` are stored as English ids, so `expandRelatedContext` **localizes** scripture cross-refs to the passage language: it rewrites the id's language segment (`scriptures:eng:<slug>:… → scriptures:ita:…`, `localizeScriptureId` — pure slug remap, no LLM) and fetches by id; any ref whose exact verse-range chunk doesn't exist in the target language (the languages chunked the same verses differently) is recovered by `fetchLocalizedScriptureRefs` — list that book+chapter in the target language by id prefix, keep chunks whose verse range overlaps (canonical slug+chapter resolution, still no LLM). `filterRelatedToLanguage` then drops anything still cross-language (e.g. English-only study helps). So an Italian `Giovanni 3:16` returns the Italian passage **plus its Italian cross-reference chunks**, never mixed English. Result is re-capped to `RELATED_CONTEXT_CAP` (exact-id matches first). The requested passage stays pinned first; the eval golden set has permanent `Giovanni 3` / `Giovanni 3:16` / `John 3` / `John 3:16` fixtures asserting first-result book/passage and scripture language (`expectFirstRefAnyOf` + `expectScriptureLanguage`).
- Structured scripture retrieval (verse + chapter, including bare chapter refs like "Alma 32") filters Pinecone on **language-invariant** signals (`language` + `chapter`) and enforces the requested book via its **slug** (chunk id 3rd segment `scriptures:<lang>:<bookSlug>:…` / URL path), NOT the display book name. This is deliberate: `parseScriptureSelection().canonicalBook` is Italian (legacy table — "Giovanni", "Salmi", "2 Nefi") and does not match the English `book` metadata, so a `book: { $eq }` filter would silently return nothing and fall back to Italian or to unfiltered semantic results. (If the canonicalBook table is ever localized to English, the slug-based matching still holds.)
- Enrichment metadata is consumed (present on enriched namespaces — scriptures + conference): the retriever maps `summary`, `topics`, `entities` (people/places/doctrines), and `references` onto each chunk. These are (a) sent to the model as per-source context via `toToolChunk` (context only — not citable sources), (b) shown as tags/reference chips on source cards, and (c) used for a small, capped topic/entity rerank boost when query terms overlap a chunk's topics/entities.
- Special scripture handling for whole chapter/book requests:
  - parses scripture references,
  - enforces chapter-oriented retrieval,
  - sorts by verse start,
  - boosts chapter coverage in returned chunks.
- Retrieval is **tool-driven** end-to-end: the model decides which retrieval
  tools to invoke via the AI SDK tools API. To prevent runaway context growth,
  a turn allows one retrieval round with at most two retrieval executions;
  `prepareStep` then disables retrieval tools, leaving optional citation
  verification followed by the final answer. Retrieval caching lives in the tool layer
  for `semantic_search`, `lookup_scripture_passage`, and `search_conference_talks`.
  `stopWhen: stepCountIs(4)` is the emergency cap for model + tool steps per
  turn. **Exception — P1 eager retrieval (flag-gated, default OFF):** for
  high-confidence topical questions on an answer-cache miss, the route can run the
  default `semantic_search` retrieval during the preamble and seed it as
  `initialChunks` (see §4 step 5b) with a preloaded-context contract so the model
  answers without an opening tool round-trip. This is NOT the old unconditional
  double-retrieval: eager warms the same tool cacheKey via the shared
  `runSemanticRetrieval()` helper, so a refinement `semantic_search` is a cache hit,
  and a conservative allowlist (`isEagerTopicalQuery`, on the original
  confidently-English question, English index only) skips scripture refs / fixed chunks / empty
  sources / chit-chat / follow-ups / specific-talk requests. Opt-in with
  `RAG_EAGER_RETRIEVAL=true` after trace validation.
- AI function tools available in the chat runtime:
  - `semantic_search` — general topical retrieval over the sources implied by
    the chat search scope, with Upstash Redis caching. The model may override
    `sources`, but only WITHIN what the UI sent: the allow-list is exactly the
    derived scope (`Standard` → `ALL_SOURCES`, `Super` → the full namespace set).
    The model cannot reach namespaces outside the active scope.
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
    cached in Upstash Redis. **Deterministic title completion:** when a requested
    title is confirmed among the semantic results, the tool identifies the talk by
    its chunk-id prefix (`conference:<lang>:<year>:<session>:<slug>`) and fetches
    the COMPLETE talk in reading order via prefix listing (`fetchConferenceTalkChunks`),
    so the model sees the whole talk rather than whichever chunks semantic search
    surfaced (`matchType` exact/confirmed, `completedTalk: true`).
  - `citation_verifier` — always performs deterministic structural validation:
    inline numeric citations must map to chunks accumulated during the turn and
    malformed markers are flagged. The nested claim-support LLM audit is default
    OFF (`RAG_CLAIM_SUPPORT_AUDIT=false`) to avoid latency/cost and structured-
    output failures. When enabled, it uses `CITATION_AUDIT_MODEL` (default
    `openai/gpt-5.4-mini`) and remains fail-open. With the audit disabled, a
    structurally valid result reports only that markers are valid; it does not
    instruct the main model to perform another retrieval.
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
  `buildSystemPrompt(effectiveStyle)`. The chat composer toolbar exposes a
  compact `ResponseStylePicker` dropdown with the 4 styles plus a "set as
  default" action (`PUT /api/settings`); changing the style mid-conversation
  persists via `PATCH /api/conversations/[id]`. (The `/search` console still
  renders `ResponseStylePicker` inside `SettingsPanel`.)

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
- `RAG_ROUTING_MODEL` (optional; defaults to `openai/gpt-oss-120b`) — dedicated retrieval-query routing/translation model, independent from `CHAT_MODEL` (`reasoningEffort: low`, 600-token ceiling)
- `RAG_ROUTING_FALLBACK_MODEL` (optional; defaults to `openai/gpt-5.4-mini`) — one-shot fallback used once if the primary routing model returns no structured output
- `RAG_LANGUAGE_ROUTING` (optional; defaults to `false`) — set to `true` only to restore the legacy dedicated routing-model path
- `RAG_CLAIM_SUPPORT_AUDIT` (optional; defaults to `false`) — enables the nested LLM claim-support pass inside `citation_verifier`; structural citation validation always remains active
- `CITATION_AUDIT_MODEL` (optional; defaults to `openai/gpt-5.4-mini`) — structured-output model used only when claim-support auditing is enabled
- `RAG_GRAPH_RERANK` (optional; defaults to `true`) — graph-aware rerank kill-switch
- `RAG_RERANK` (optional; defaults to `false`) — Voyage cross-encoder rerank
- `RAG_MULTI_QUERY` (optional; defaults to `false`) — multi-query expansion
- `RAG_MMR` (optional; defaults to `false`) — per-source/per-title diversity caps
- `CHAT_MEMORY_ENABLED` (optional; set to `false` to disable chat personalization memory)
- `CHAT_MEMORY_BRIEF_CHARS` (optional; defaults to 700; caps the compact memory brief injected into each chat request)
- `CHAT_MEMORY_CONTEXT_CHARS` (optional; defaults to 3500; caps full memory context available through the memory read tool)
- `CHAT_MAX_RESPONSE_SOURCES` (optional; defaults to 50) — per-turn cap on unique chunks exposed to the model and persisted/returned with the response
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
  - `src/components/chat/ChatInterface.tsx` (orchestration: chat transport, conversation lifecycle, billing/usage, regeneration, composer)
  - `src/components/chat/ChatMessage.tsx` (per-message render: response, action toolbar, feedback panels, sources, version nav, pending indicators)
  - `src/components/chat/useMessageFeedback.ts` (feedback state machine: thumbs persistence, follow-up auto-dismiss timer, submit, reset)
  - `src/components/chat/chat-utils.tsx` (shared chat helpers + `ToolActivityIndicator`/`PendingIndicator`, imported by both `ChatInterface` and `ChatMessage`)
  - `src/components/chat/SettingsPanel.tsx` (source/style filter bar — now only the `/search` console)
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
  - `src/app/api/chat/[id]/stream/route.ts` (resume the owned active stream)
  - `src/app/api/search/route.ts`
  - `src/app/api/billing/subscription/route.ts`
  - `src/app/api/conversations/route.ts`
  - `src/app/api/conversations/[id]/route.ts`
  - `src/app/api/settings/route.ts` (per-user prefs: response style + onboarding state)
- User settings:
  - `src/lib/db/user-settings.ts` (read/write `rag_user_settings`)
- Chat generation lifecycle:
  - `src/lib/chat/client-lifecycle.ts` (bounded client claim/polling and sidebar-page merge rules)
  - `src/lib/chat/generation.ts` (active/stale/ownership and persisted-turn rules)
  - `src/lib/chat/resumable-stream.ts` (`resumable-stream/generic` Upstash adapter)
  - `migrations/0010_sad_pestilence.sql` (conversation generation-state columns)
  - `scripts/test/chat-lifecycle.test.ts` (pure lifecycle regression suite)
- Onboarding tour (first-visit guided tutorial, issue #12):
  - `src/lib/onboarding/steps.ts` (pure step/anchor/auto-start logic; tested by `test:onboarding`)
  - `src/components/onboarding/OnboardingTour.tsx` (anchored callouts, replay, persistence, a11y)
  - mounted in `src/components/layout/AppShell.tsx`; anchors are `data-tour` attributes in
    `ChatInterface` (composer, `super-toggle`, `response-style`)/`SourcesPanel`/`ChatSidebar`;
    replay entry in `ChatSidebar`. The `source-toggles` step was removed with the chat's
    per-source UI.
- RAG internals:
  - `src/lib/rag/system-prompt.ts`
  - `src/lib/rag/retriever.ts`
  - `src/lib/rag/embedder.ts`
  - `src/lib/rag/reranker.ts` (Voyage cross-encoder rerank, `RAG_RERANK`)
  - `src/lib/rag/query-expansion.ts` (multi-query expansion, `RAG_MULTI_QUERY`)
  - `src/lib/rag/flags.ts` (retrieval feature flags)
  - `src/lib/rag/cache.ts`
  - `src/lib/rag/scripture-reference.ts`
  - `src/lib/rag/citation-links.ts`
  - `src/lib/rag/tools/index.ts` (factory)
  - `src/lib/rag/tools/shared/` (tool-context, chunk-formatting, text-normalize)
  - `src/lib/rag/tools/semantic-search/`
  - `src/lib/rag/tools/lookup-scripture-passage/`
  - `src/lib/rag/tools/search-conference-talks/`
  - `src/lib/rag/tools/citation-verifier/`
- Observability:
  - `src/lib/observability/latency.ts` (per-turn `LatencyTrace` builder + tool-timing wrapper)
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
- Chat generation and stream-resume routes have a 180-second execution limit.
  Navigation or closing the browser does not by itself cancel an active producer,
  but this is not a durable queue: a server process crash or deployment can still
  interrupt generation before the assistant message is persisted.
- A pending first turn (`streaming` with no `active_turn_id`) is stale after 30
  seconds; a claimed `streaming` generation is stale after four minutes. Recovery
  is compare-and-set and cannot clear a newer replacement turn.
- Upstash REST enables token-level stream resume. Without it, generation can still
  continue within the live server function and clients poll persisted status, but
  partial stream tokens cannot be replayed after navigation.
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
- Chat lifecycle test: `npm run test:chat-lifecycle` (pure, network-free coverage
  for pending/active stale state, resume eligibility, turn ownership, tail-turn
  idempotency, bounded client claim recovery, inline pending state, and sidebar paging)
- Retrieval eval: `npm run eval` (golden set in `scripts/eval/dataset.ts`; reports
  MRR/recall/structural checks with the cross-encoder reranker off vs on, writes
  JSON to `scripts/eval/results/`). The harness forces both rerank arms itself, so
  off→on isolates `RAG_RERANK` regardless of the env value (graph rerank is held
  constant across both arms; multi-query/diversity follow their env flags and apply
  to both arms — toggle their env and re-run to measure those). Two retrieval calls
  per case. Hits live Pinecone + Voyage. Add a filter: `npm run eval -- faith`.
- Routing fast-path test: `npm run test:routing` (`scripts/test/language-routing.test.ts`)
  — pure, network-free assertions that the local same-language short-circuit
  (`detectIndexLanguageMatch`) fires only for confidently, dominantly index-language
  prompts and that mixed/quoted/cross-language prompts fall through to the LLM.

### Feature flags (`src/lib/rag/flags.ts`)
- `RAG_GRAPH_RERANK` (default **on**) — graph-aware reranking. Enabled by default
  (eval shows it improves ranking with no regressions); set to `false` as a
  kill-switch.
- `RAG_RERANK` (default **off**) — Voyage `rerank-2.5` cross-encoder rerank of the
  merged candidate pool (`reranker.ts`). Adds an external API call (cost + latency);
  validate against `npm run eval` before enabling per-deployment. Applies uniformly
  to all languages — in production the query reaching the cross-encoder is already
  translated into the index language by the tool's lazy language routing, so there is no
  per-input-language axis to gate on. Net-positive on the gold set (recall
  0.629 → 0.696). Caveat: the win is uneven per query — the reranker still demotes
  Alma 32 on faith queries (`italian-topic-faith` recall 1.0 → 0.0 even with the
  production-style translation now applied via the eval's `routeQuery` flag), so it
  is a narrow query-specific weakness, not a language one. Weigh per-deployment.
- `RAG_MULTI_QUERY` (default **off**) — multi-query expansion (`query-expansion.ts`).
  Adds one small LLM call per search.
- `RAG_MMR` (default **off**) — per-source / per-title diversity caps on the top-k.
- `RAG_EAGER_RETRIEVAL` (default **off**, opt-in) — P1 eager/speculative retrieval.
  Runs the default `semantic_search` during the preamble on an answer-cache miss and
  seeds the chunks (with a preloaded-context contract) as `initialChunks` so the model
  answers on turn 1 (kills the empty tool-decision round-trip). Conservative allowlist
  (`isEagerTopicalQuery`, false-negatives preferred, classifying the original
  confidently-English question on the English index only): skips scripture refs / fixed chunks / empty
  sources / chit-chat / response-edit follow-ups / specific-talk requests. Warms the
  same tool cacheKey (a refinement tool call is then a cache hit). Deliberately NOT part
  of `retrievalFlagsSignature()` — it changes *when* retrieval runs, not the cached
  results. Enable with `true` only after latency-trace + output/citation parity
  validation (go/no-go: topical p50 `serverFirstTextMs` ≥ ~1s or ~20% better, else remove).

## 12) Update policy for agents

### Active implementation plan

- `docs/TOOL_SPECIFIC_LANGUAGE_ROUTING_PLAN.md` records the earlier dedicated
  routing design. The active chat path now performs answer-language inference and
  retrieval-query translation in `CHAT_MODEL`'s existing tool-decision step;
  `RAG_LANGUAGE_ROUTING=true` retains the previous router only as a rollback path.

When changing architecture, behavior, integrations, API contracts, or major UX flow:

1. Update this file in the same change.
2. Update `AGENTS.md` if process instructions changed.
3. Run `npm run docs:guard`.

The goal is to make future agent sessions start from this document and avoid repeated
exploratory searching.
