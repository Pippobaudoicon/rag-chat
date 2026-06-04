# Changelog

## 0.9.3

- Fixed a cache-correctness issue in `lookup_scripture_passage`: it previously cached the *post-rerank* result while the cache key omitted `RAG_GRAPH_RERANK`, so flipping the flag wouldn't take effect on cache hits until TTL expiry (stale plain order after enabling, stale reranked order after disabling). It now caches the neutral, pre-rerank `{ passage, related }` split and applies the graph rerank *after* the cache read — matching `semantic_search`'s pattern. The cache-shape version (`v`) was bumped so old flat-array entries are ignored rather than mis-parsed.

## 0.9.2

- Enabled graph-aware reranking by default (`RAG_GRAPH_RERANK` now defaults to on). The eval harness consistently shows it improving ranking with zero regressions, so it is on for everyone. The flag is retained only as a kill-switch (`RAG_GRAPH_RERANK=false`).

## 0.9.1

- Fixed scripture-reference retrieval, which was broken by a stale `parseScriptureSelection` table: `canonicalBook` values are Italian (legacy index), and the retriever used them in Pinecone `book: { $eq }` filters. After the English migration these never matched the English `book` metadata, so structured verse/chapter retrieval returned nothing and fell back to Italian (leak) or to unfiltered semantic search (wrong chapter — e.g. "Alma 32" returning Alma 30/33).
- The retriever now constrains structured scripture queries by language-invariant signals (`language` + `chapter`) and enforces the book via the slug (chunk id 3rd segment / URL path) in `isRequestedScriptureChunk`, instead of the language-specific book name.
- Chapter-level references (e.g. "Alma 32", with no verse) now always trigger structured chapter retrieval, so the exact chapter is returned instead of semantically-near chapters, and only in the answer language.
- `lookup_scripture_passage`'s strict post-filter now matches on the book slug too (was comparing the Italian `canonicalBook`).
- Verified by the eval harness: scripture cases go from "Alma 32 not found / 4 language failures" to all five at rank 1 with correct language; structural checks 16/20 → 20/20; baseline MRR 0.35 → 0.51.

## 0.9.0

- Added graph-aware reranking over the cross-reference graph already projected into Pinecone metadata. A retrieved chunk that is cross-referenced by several others in the result neighborhood is central to the topic, so it gets a small, capped score boost (a principled tiebreaker among semantically-close candidates, like the topic/entity boost). `semantic_search` reranks the whole result set; `lookup_scripture_passage` keeps the requested passage pinned and reranks only the supporting cross-references/study-helps. Shared helper: `tools/shared/graph-rerank.ts`.
- This is genuinely multi-hop (expanded chunks carry their own `related_ids`, so hop-2 connectivity is observed) and needs no sidecar: the 60MB `cross_references.jsonl` graph is never shipped to the runtime — only the per-vector forward edges already in Pinecone metadata are used. (Full-graph authority signals, e.g. TG-hub co-citation, remain a future offline/scraper-side metadata enhancement.)
- Graph-aware reranking is gated behind the `RAG_GRAPH_RERANK` flag (`src/lib/rag/flags.ts`), **default off**, so it can be A/B-measured before it is trusted unconditionally.
- Added a retrieval eval harness (`npm run eval`, `scripts/eval/`): runs a golden set through the real retrieval pipeline and reports relevance metrics (MRR, recall, structural checks) with graph-rerank off vs on. First run: rerank improves MRR ~0.35 → ~0.44 with 0 cases worsened. The harness also surfaced two pre-existing issues to fix next: Italian scripture chunks leaking into English results, and `parseScriptureSelection` still returning Italian `canonicalBook` values (so `lookup_scripture_passage`'s strict book/chapter filter is dead post-English-migration and falls back to unfiltered semantic results).

## 0.8.0

- Updated the chat system prompt so the agent automatically considers retrieved cross-references, study-help entries, enrichment metadata, and related chunks as supporting context when they improve the answer, even if the user does not explicitly ask for cross-references.
- Tuned the answer style toward religious-scholar depth with plain, age-accessible explanations, warm tone, and clear practical takeaways.
- Clarified retrieval tool descriptions so `lookup_scripture_passage` and `semantic_search` advertise their related-context payloads to the model.

## 0.7.0

- `semantic_search` now expands its results with the cross-reference graph, the same way `lookup_scripture_passage` already did. After the topical search, it pulls a bounded slice of each top hit's `related_ids` (cited passages + Bible Dictionary / Guide to the Scriptures entries) and attaches them as supporting context. Expansion is deliberately conservative — only the strongest hits (`fromTopN`) seed it and the total is capped — so it adds scholar-grade depth without diluting or bloating the payload. Related context respects the user's selected source filters, including cached retrieval results.
- Extracted the passage-expansion logic into a shared `expandRelatedContext` helper (`tools/shared/related-context.ts`) used by both retrieval tools.

## 0.6.0

- Started consuming enrichment metadata (previously stored but unused). The retriever now maps `summary`, `topics`, `entities` (people/places/doctrines), and `references` into each source chunk.
- Feed enrichment to the model: `toToolChunk` now includes summary, topics, entities, and references so the LLM has structured thematic context per source (system prompt explains they are context, not citable sources).
- Source cards now display topics/entities as tags and the passage's cited references as chips.
- Light topic/entity rerank: query terms overlapping a chunk's enriched topics/entities apply a small, capped score boost to refine ordering among semantically-close candidates.

## 0.5.0

- `lookup_scripture_passage` now expands a passage with its cross-reference graph: it fetches each chunk's `related_ids` (cited passages + Bible Dictionary / Guide to the Scriptures entries) by id and attaches them as supporting context for fuller, scholar-grade answers.
- Scripture verse/chapter retrieval now prefers the answer language (queries it first, falls back to the other indexed language only if empty), so English questions return English scripture instead of Italian.
- Consumed the graph `related_ids` projection for the first time (retriever maps `related_ids`; added `fetchRelatedChunks`).

## 0.4.0

- Migrated retrieval to the `lds-rag-v1` Pinecone index (English-main corpus, 72,882 vectors) as the new default.
- Switched default retrieval language to English (`RAG_INDEX_LANGUAGE=eng`); scriptures still retrieve in English + Italian.
- Added the `study_helps` source (Bible Dictionary, Guide to the Scriptures, JST) as an individual filter, on by default. Topical Guide is graph-only and intentionally not retrievable.
- Retired legacy namespaces `liahona`, `gospel_family`, `gospel_videos`, and `gospel_handbook` (gospel_handbook content now lives under `handbook`); kept `gospel_music` as a planned-but-empty namespace.

## 0.3.28

- Reduced chat token usage by injecting only a compact personalization memory brief into each request.
- Added an on-demand `read_personal_memory` tool so the model can load full saved memory only when relevant.
- Changed answer cache invalidation to use a compact memory version signature instead of the full memory prompt.

## 0.3.27

- Replaced the memory sidebar modal with a dedicated `/memory` page matching the billing page layout pattern.
- Updated sidebar memory navigation to open the memory page directly.

## 0.3.26

- Localized the `/search` frontend through the shared UI language system.
- Added Italian and English copy for search controls, examples, result metrics, empty states, and errors.

## 0.3.25

- Added a dedicated `/search` frontend for authenticated semantic source search.
- Added sidebar navigation for direct source search alongside chat history.
- Reused shared source filters, language context, and source dialogs for search results.
- Added a polished retrieval-console UI with result metrics, topK controls, examples, loading states, and empty/error states.

## 0.3.24

- Localized and polished the billing page with plan status, usage meters, plan comparison, and upgrade calls to action.
- Added Redis-backed chat/search usage snapshots for billing visibility.
- Added a Free-plan chat banner when users approach their chat request limit.
- Made Clerk subscription detail loading best-effort and silenced the expected `billing_not_enabled` fallback.
- Switched Pro detection to prefer Clerk `auth().has({ plan })` checks.
- Moved billing usage writes to Next `after()` so they remain non-blocking.
- Stored usage snapshots from the actual Upstash rate-limit result so billing usage reflects enforced limits.
- Disabled checkout with explicit Clerk Billing enablement copy when the active Clerk instance reports billing disabled.

## 0.3.23

- Added Clerk Billing entitlement detection for Free and Pro subscription plans.
- Added plan-aware rate limits for chat and semantic search requests.
- Added `/api/billing/subscription` and a first `/billing` page with Clerk checkout/subscription actions.
- Added subscription environment variables for Clerk plan IDs, plan slugs, limits, and retrieval caps.
- Set the default Pro Clerk Billing plan key/slug to `pro_user`.
- Pinned `@clerk/nextjs` because Clerk Billing APIs are beta/experimental.

## 0.3.22

- Added streamed chat progress events so new chats can show queued, searching, tool, and drafting states while the assistant is working.
- Moved first-message conversation creation into the chat request path to avoid an extra client-side preflight request before sending.
- Added discreet waiting copy and tool activity indicators for retrieval/tool phases.
- Updated retrieval tools to report live progress details including tool name, source count, cache hit, and elapsed time.
- Made retrieval tool cache writes non-blocking so Redis writes do not delay the model after a tool finishes.
- Batched Voyage embeddings for conference talk query candidates to reduce repeated embedding calls during `search_conference_talks`.
- Updated PWA service worker handling to avoid caching `/_next/*` runtime chunks and unregister service workers in development, preventing stale module factory errors.

## 0.3.12

- Decoupled UI language selection from retrieval and answer-language routing.
- Added query language detection and translation into the configured Pinecone index language before search.
- Added a scalable UI language selector with additional interface language options and English fallback copy.
