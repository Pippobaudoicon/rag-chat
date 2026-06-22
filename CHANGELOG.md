# Changelog

## 0.12.11

- **Short-circuit the language-routing LLM call for same-language prompts (Phase 2 · P0-A).** `routeQueryLanguage()` previously ran a full `generateText` (structured output, up to 600 tokens) on **every** turn — the `routing` latency phase — even when the prompt was already in the index language (default index = English), where the "translation" is identity. It now detects the prompt language **locally** first (via `tinyld`, a small profile-based detector) and, when the detected language matches the index language, returns the same `QueryLanguageRouting` result without calling the LLM (`searchQuery` = original, `translated: false`, `inputLanguageCode` = the detected 2-letter code). The `routing` phase drops to ~0 on the English path; `preStreamMs` / `serverFirstTextMs` fall correspondingly. Benefits both `POST /api/chat` and `GET /api/search`.
  - **Cross-language & mixed-language fidelity preserved.** The fast-path fires **only** when the prompt is *confidently, dominantly* in the index language — extracted into the pure `detectIndexLanguageMatch()` helper, which requires the top detected language to be the index language with accuracy ≥ 0.9 **and** no significant secondary language (≥ 0.15). Genuinely cross-language prompts (Italian → English index) and **mixed/quoted-language** prompts keep the LLM path. This closes a codex finding: `Rispondi in italiano: <English question>` (or a non-English question quoting a long English passage) is dominantly English by token count, so a naïve top-classification short-circuit would have wrongly answered in English with an untranslated query; the dominance gate routes those through the LLM (calibration: pure prompts classify at accuracy 1.0, any mixing drops to ≤ ~0.83). tinyld also returns nothing for too-short/ambiguous input (e.g. a bare `Alma 32:21`) → LLM fallback.
  - **Library choice — tinyld over franc (justification):** on realistic LDS prompts `franc` misclassifies common English (e.g. "What is the law of chastity…" → `sco` Scots), so a `=== eng` gate would under-fire and forfeit the win on most English queries. `tinyld` classifies en/it/es/fr correctly with high confidence and returns empty for too-short input. tinyld emits ISO 639-1; the index `CorpusLanguage` (`eng`/`ita`) is mapped to `en`/`it` for the comparison.
  - **Contract unchanged:** the `QueryLanguageRouting` shape is byte-identical; `translated` has no external consumers (it is now `false` on the same-language path, which is also more accurate). Redis-cached routing (the plan's optional step 4) was intentionally **not** added — kept minimal.
  - **Tests/guards:** new `npm run test:routing` (`scripts/test/language-routing.test.ts`) — a pure, network-free regression test asserting pure-language prompts short-circuit while mixed/quoted/cross-language prompts use the LLM (9 cases incl. the codex repro). `npm run eval` — recall/MRR unchanged and the `italian-*` cross-language cases still pass (they detect as `it` and keep the LLM translation path, so they are unaffected by construction).

## 0.12.10

- **Parallelize the chat pre-stream preamble (Phase 2 · P0-B).** `POST /api/chat` previously awaited a chain of mostly-independent preamble operations serially: conversation load → messages load → language routing → memory brief → user prefs, each in its own latency phase. The independent reads (messages load, language routing, memory brief, user prefs) now run concurrently in a single `Promise.all`, collapsing `preStreamMs` from roughly the **sum** of those phases toward their **max**. Individual `phases.*` durations are unchanged; only their overlap improved. No behavior change otherwise.
  - **Gate ordering preserved.** The `auth` (401), `ratelimit` (429), and conversation **ownership** (404) gates all resolve *before* the parallel batch, so a rejected request never speculatively pays for the language-routing LLM call or the memory/prefs reads — and a deleted/unowned `conversationId` still 404s promptly rather than waiting on (or being masked by a failure in) routing/memory/prefs (codex review). The ownership gate is a single indexed `convLoad`; the heavier `messagesLoad` runs inside the batch behind it. `entitlements` + `ratelimit` likewise stay sequential ahead of the batch to honor "don't burn LLM cost on a request you're about to reject" — the routing LLM call dominates the batch anyway, so the reads hide behind it.
  - **Routing for the deferred-question case.** Routing runs inside the batch for the common case (question known up front). For regenerate requests whose transport omits the question text (resolved from stored history), the single routing call is deferred until after the conversation loads and the fallback question is known — still exactly one `routeQueryLanguage` call per turn.
  - **Early returns and write-ordering intact:** 401 (auth), 429 (ratelimit), 404 (conversation not found / not owned), and 400 (empty question) all still fire, and no writes (user-message insert, conversation create, per-conversation style override) happen before validation/ownership passes. `prefs` is now fetched eagerly in the batch instead of lazily, so the `prefs` phase is recorded on every turn (previously only when no per-conversation style override existed).

## 0.12.9

- **Per-turn latency instrumentation (baseline for the chat-latency optimization work).** Assistant `details_json` now carries a versioned `latency` trace (`LatencyTrace` in `types.ts`) alongside the existing total `latencyMs`: independent pre-stream phase durations (`auth`, `entitlements`, `ratelimit`, `convLoad`, `messagesLoad`, `routing`, `memoryBrief`, `answerCacheLookup`, `userMsgInsert`, `prefs`), ordered milestones (`preStreamMs`, `firstModelChunkMs`, `firstToolCallMs`, `serverFirstTextMs`, `answerReadyMs` — generation/cache-resolved, before the trailing DB/cache writes), per-step **inclusive** wall time (`steps[].wallMs` = model + in-step tool execution), and per-tool `{name, durationMs, ok, cacheHit}`. The Grafana role is provisioned out-of-band (no credentials in tracked SQL); the dashboard measures the tool-decision turn as `firstToolCall − preStream`. A `path` tag (`generated` | `answer-cache` | `regenerate`) keeps the instant answer-cache returns out of cold-path percentiles, and `release` (`VERCEL_GIT_COMMIT_SHA`) enables before/after comparison. New `src/lib/observability/latency.ts` provides `createLatencyTrace` (independent `performance.now()` durations — not a cumulative mark) and a `withToolTiming` wrapper applied to the whole tool set. No schema migration — `details_json` is already JSONB. `serverFirstTextMs` is the server's first emitted text *after* `smoothStream`, not browser first paint. Trace is written on completed responses only — aborted/errored requests are absent, so derived percentiles are an optimization baseline, not an operational SLO.

## 0.12.8

- **Citation verifier no longer claims "all supported" when the audit didn't run.** When the claim-support audit returns null (the LLM failed, or no citable claims were extracted), the note previously still read "All citation markers are valid, in range, and supported by their cited sources." It now distinguishes three states: audit complete → "supported"; audit ran but partial → "did not cover every claim"; audit unavailable → "claim support was NOT verified — verify manually." (`isValid` was already correct; this is the human-readable note.)
- **Docs consistency:** `PROJECT_INFO.md`'s `RAG_RERANK` note no longer says the Italian regression was a raw-Italian-input artifact (contradicted by the 0.12.7 re-measure). It now matches the changelog: rerank applies uniformly and is net-positive on the gold set, with a narrow query-specific weakness (drops Alma 32 on faith queries even after production-style translation).

## 0.12.7

- **Removed the per-language rerank gate (`RAG_RERANK_LANGUAGES`); rerank now applies uniformly.** Code review (P1) showed the gate keyed off the *index* language (always `eng` on `lds-rag-v1`), never the user's `inputLanguageCode`, so it was a no-op for real chat/search traffic — Italian prompts are translated to the index language before retrieval. Removed `isRerankAllowedForLanguage` (`flags.ts`), dropped the `rl:` component from `retrievalFlagsSignature()`, simplified `useRerank` in `retriever.ts`, and removed the env var from `.env.example` / `.env.local` / `docs/PROJECT_INFO.md`.
- **Eval now mirrors production language routing for cross-language cases.** Added a `routeQuery` flag to `EvalCase`; when set, the harness translates the prompt via `routeQueryLanguage` before retrieving (resolved once so both rerank arms are identical). The two `italian-topic-*` cases use it, so the cross-encoder sees the same English query it does in production rather than a raw Italian string.
- **Re-measure (45 cases, translated cross-language, graph-rerank on, multi-query/diversity off):** uniform cross-encoder rerank is net-positive — recall **0.629 → 0.696** (+0.067), MRR **0.569 → 0.576** (+0.007), 8 cases improved / 7 worsened / 16 unchanged, structural 86/88 (the 2 fails are pre-existing Italian scripture-language leakage, unrelated to rerank). **Correction to 0.12.4/0.12.5:** the earlier "Italian regression" was *not* merely an artifact of feeding raw Italian to the reranker — with the production-representative translated query, rerank still drops Alma 32 from the faith case (`italian-topic-faith` recall 1.0 → 0.0; the English `topic-faith` finds Alma 32 in neither arm). So it is a narrow, query-specific cross-encoder weakness on faith→Alma 32, not language-bound — which is exactly why a per-language gate was the wrong tool. Net effect on the gold set is still positive; this one passage is the notable casualty. `RAG_RERANK` stays default-off pending a per-deployment decision.

## 0.12.6

- Review follow-ups (code-review findings):
  - **Conference talk completion now fails open.** `search_conference_talks` wraps the `fetchConferenceTalkChunks` call in try/catch, so a listing/fetch error (transient, or a non-serverless index where `listPaginated` is unsupported) falls back to the already-valid semantic results instead of failing the whole tool. Completion stays a best-effort upgrade over the semantic slice.
  - **Claim audit reports coverage honestly.** `auditClaimSupport` now de-dupes the model's per-claim verdicts and returns a `complete` flag that is true only when every cited claim was assessed exactly once (no claim dropped by the 20-claim cap, none omitted by the model). `citation_verifier` surfaces `audited` from that flag (plus a new `claimsFound` count) and the note no longer says "all supported" when the audit was partial — preventing an incomplete audit from reading as a clean bill of health. Unsupported claims are still flagged and still set `isValid: false`.
  - **Session-answer cache preserves the retrieval trace.** `SessionAnswerCacheEntry.details` now carries the `RetrievalTrace`; it is written on cache fill and replayed into the persisted assistant message on a cache hit, so cache-hit turns remain mineable into the eval gold set (previously the trace was dropped on hits).

## 0.12.5

- **Per-language rerank gate (`RAG_RERANK_LANGUAGES`).** The cross-encoder reranker can now be scoped to a configurable, comma-separated allowlist of retrieval languages (e.g. `eng`); empty/unset = all languages. Language-agnostic by design — nothing is hard-coded to a specific language; add codes as new languages are validated. Motivated by eval: Voyage rerank-2.5 lifted English recall (+7.8pts) but *hurt* Italian (dropped Alma 32). Gate lives in `isRerankAllowedForLanguage` (`flags.ts`), is applied in `retrieve()` (even over an explicit override, so the eval harness reflects the configured policy), and is folded into `retrievalFlagsSignature()` so changing it invalidates cached retrievals. Verified: with `RAG_RERANK_LANGUAGES=eng`, Italian cases skip rerank (recall 1.0→1.0, regression gone) while English cases still rerank (recall 0→0.25).
- Enabled locally (`.env.local`): `RAG_RERANK=true` + `RAG_RERANK_LANGUAGES=eng` — the validated English win without the Italian regression. Production env is unchanged (set the same two vars in the Vercel dashboard to roll out).

## 0.12.4

- **Retrieval trace persistence (#8).** Assistant `details_json` now carries a `retrieval` trace (`RetrievalTrace` in `types.ts`): input language, translated search query, index language, source filters, topK, the ranking-flag signature, and per-tool stats (sourceCount / cacheHit / elapsedMs, captured from the existing progress events). The retrieved chunks already live in `sources_json`; this records the *how* so real conversations can be mined into the eval gold set. No schema migration — `details_json` is already a JSON column.
- **Eval gold set: cross-language coverage (#8).** Added two Italian topical/semantic cases (`italian-topic-faith`, `italian-topic-repentance`) to `scripts/eval/dataset.ts` (45 cases total). These immediately surfaced a useful signal: the Voyage cross-encoder reranker *hurts* the Italian faith case (drops Alma 32 from rank 3), i.e. it has a cross-lingual weakness — reinforcing that `RAG_RERANK` should stay default-off and be weighed per-language before enabling.

## 0.12.3

- **Citation verifier now audits claim support (#5), not just index validity.** Added a bounded, fail-open LLM pass (`citation-verifier/claim-support.ts`) that checks each cited sentence is actually backed by the source it cites, returning `supported` / `partial` / `unsupported` per claim with a brief reason. `citation_verifier` now returns a `claimSupport` block and sets `isValid: false` when any claim is unsupported (in addition to invalid/malformed markers); `note` lists the offending claims. New `extractCitedClaims` pairs each cited sentence with its indices. The system prompt instructs the model to correct/re-cite/remove unsupported claims (and qualify partial ones) before sending. Fails open: if the audit LLM call errors it is reported as "not audited", never as "all supported". Verified: a fabricated "coffee and tea are forbidden [1]" citing a faith passage is correctly flagged unsupported while faithful claims pass.

## 0.12.2

- **Conference exact-title lookup → deterministic talk completion (#4).** When `search_conference_talks` confirms a requested title among the semantic results, it now identifies the talk by its chunk-id prefix (`conference:<lang>:<year>:<session>:<slug>`) and fetches the COMPLETE talk in reading order via Pinecone prefix listing (new `fetchConferenceTalkChunks` / `conferenceTalkKey` in `retriever.ts`), rather than returning whichever chunks semantic search happened to surface. The response carries `completedTalk: true` and an explicit note. Verified end-to-end: "Think Celestial" returned all 7 chunks in order where semantic search had surfaced only 5. (Chose the lighter Pinecone-only approach over a committed/DB talk catalog — an existing talk virtually always surfaces semantically given the title-enriched query candidates, so a catalog's marginal benefit didn't justify the sync/maintenance overhead.)
- **Source-permission fix (#6).** `semantic_search`'s model `sources` override is now ceilinged to exactly the sources the user enabled in the UI. Previously, selecting all five VISIBLE toggles (`ALL_SOURCES.length`) was mis-read as "Super" and silently unlocked the hidden namespaces the user never selected. "Super" remains explicit (it sends the full `SUPER_SOURCES` set).

## 0.12.1

- Reranker correctness fixes (follow-up to 0.12.0 review):
  - **Rerank the globally strongest candidates.** `rerankChunks` now sorts the merged pool by score before taking the top `MAX_RERANK_CANDIDATES` (100). Previously it sliced the first 100 in namespace/multi-query fan-out order (which is grouped, not globally score-sorted), so strong later-namespace / later-variant candidates could be excluded from reranking.
  - **Keep the unreranked tail below all reranked chunks.** Candidates beyond the cap (and any Voyage omits) kept raw cosine scores that were then sorted together with Voyage relevance scores — a different scale — so a tail chunk at cosine ~0.85 could outrank a reranked chunk at relevance ~0.5. They are now demoted just below the lowest relevance score, preserving order.
- **Retrieval cache keys now vary with the ranking flags.** Added `retrievalFlagsSignature()` (`flags.ts`); `cacheKey()` takes it and the chat route's session-answer key includes it. Previously, toggling `RAG_RERANK` / `RAG_MULTI_QUERY` / `RAG_MMR` left the cache key unchanged, so old behavior could be served until the TTL expired. (Graph rerank is excluded — it is applied after the cache read in the tools.)
- **Eval harness caveat corrected.** The off→on columns cleanly isolate the reranker only with multi-query OFF; with `RAG_MULTI_QUERY=on` the two arms generate independent (non-deterministic) variants, so the columns conflate reranking with pool differences. Documented; multi-query/diversity are still measured correctly by comparing the same arm's aggregate across two runs.
- Stripped pre-existing trailing whitespace in `AGENTS.md` (failed `git diff --check`).

## 0.12.0

- Added an optional, flag-gated **retrieval ranking stack** to `retrieve()` (semantic fan-out path only — the structured scripture verse/chapter short-circuits are untouched). Three independent stages, all default OFF, each A/B-able with `npm run eval`:
  - **Cross-encoder rerank** (`RAG_RERANK`, new `src/lib/rag/reranker.ts`): the merged candidate pool is scored against the query by Voyage `rerank-2.5`. A cross-encoder scores every candidate directly, so its relevance scores are comparable across namespaces/languages — dissolving the long-standing problem that raw Pinecone cosine isn't calibrated across namespaces (a 0.62 in `conference` ≠ a 0.62 in `gospel_study`). The relevance score becomes the primary sort key; the existing topic/entity boost and language tiebreak remain small secondary nudges. Fails open (keeps input order on any API error). Distinct from, and complementary to, the in-Pinecone graph rerank.
  - **Multi-query expansion** (`RAG_MULTI_QUERY`, new `src/lib/rag/query-expansion.ts`): an LLM generates up to 2 alternative phrasings (canonical LDS terminology + plainer wording), embedded alongside the original and fanned out across the namespaces, then merged/deduped to lift recall before reranking. Falls back to the single original query on any error.
  - **Diversity caps** (`RAG_MMR`): per-source (max 6) and per-title/talk (max 3) caps on the sorted top-k so one namespace or talk can't crowd out complementary evidence; over-cap chunks spill to the end and can still backfill.
- `retrieve()` now takes an optional `RetrieveOptions` (`{ rerank, diversity, multiQuery }`) so callers and the eval harness can force a stage independent of the env flag. All existing call sites are unchanged (options default to the env flags).
- Eval harness (`scripts/eval/run.ts`) now measures the cross-encoder reranker off→on directly (forces both arms itself, two retrieval calls per case), holding graph rerank constant across both arms; multi-query/diversity follow their env flags and apply to both arms. Prints the active flags and records them in the results JSON.
- New flags in `src/lib/rag/flags.ts`: `isRerankEnabled` (`RAG_RERANK`), `isDiversityEnabled` (`RAG_MMR`), `isMultiQueryEnabled` (`RAG_MULTI_QUERY`), all default OFF. Documented in `.env.example` and `docs/PROJECT_INFO.md`.

## 0.11.1

- Reduced the UI footprint of the response-style control. The four chips + label + star that took a full row in the settings bar are now a single compact dropdown pill (`ResponseStylePicker`) showing the active style's glyph + label, sitting inline after the Super toggle. The popover holds the four styles (each with a distinct glyph + description and a radio check). Each row carries a small "make this the default" star pinned to its bottom-right (below the active check); the current default is filled, the rest brighten on hover. On mobile the trigger collapses to just the glyph. No behavior or API change — purely presentational.
- Added a reusable `secondary-accent` theme color (`--secondary-accent: #415a77`, a slate-blue) to `globals.css`, exposed as `text-/bg-/fill-/border-secondary-accent`. Used for the default-style star so it matches the page's restrained, monochrome-plus-indigo palette instead of a bright accent. Defined once in `:root` and inherited by `.dark` (theme-independent), kept separate from the shadcn `secondary` token so secondary buttons are unaffected.

## 0.11.0

- Added a user-selectable **response style** so readers can choose how answers are written without ever relaxing source-grounding or citation rules. Four styles: `balanced` (default — scholar depth in plain words), `scholar` (deeper, adult, terms allowed), `simple` (Primary/child), `concise` (short and direct).
- Two-level persistence with override resolution **conversation override → user default → system default (`balanced`)**:
  - New `rag_user_settings` table (`default_response_style`) holds each user's persistent default, applied to new conversations. Kept separate from the memory-profile tables so background profiling can't clobber it. Read/written via `src/lib/db/user-settings.ts`.
  - New nullable `rag_conversations.response_style` column holds a per-conversation override (NULL = inherit the user default). Migration `0008_clean_sway.sql`.
- API: new `GET`/`PUT /api/settings` for the user default; `POST /api/conversations` and `PATCH /api/conversations/[id]` now accept `responseStyle` (PATCH also still renames); `POST /api/chat` accepts a per-turn `responseStyle`, persists it as the conversation override, resolves the effective style, and builds the system prompt with it.
- UI: the chat settings bar (`SettingsPanel`) now shows the four styles with description tooltips plus a star "set as default" action (`PUT /api/settings`); mid-conversation changes persist immediately via `PATCH /api/conversations/[id]`. Italian + English labels added; other UI languages fall back to English. The search console reuses `SettingsPanel` for source filtering only (style controls are optional and hidden there).
- The chat route now composes the system prompt via `buildSystemPrompt(effectiveStyle)` instead of the static `SYSTEM_PROMPT` constant.

## 0.10.0

- Restructured the chat system prompt (`src/lib/rag/system-prompt.ts`) into a constant CORE (identity, retrieval, grounding, citation, and memory rules) plus a swappable **response-style** block that controls only the *voice and altitude* of the answer. Depth, source-grounding, and citation rules are now style-independent and never relax.
- Sharpened the default "Balanced" style from a vague "scholar-care + teacher-clarity" aspiration into an operational readability contract: it separates DEPTH (kept in the substance — close reading, context, cross-references) from SIMPLICITY (applied only to the wording), requires a plain one-sentence lead, define-on-first-use for doctrinal/technical terms, a concrete analogy for hard ideas, and a dual self-check ("could a child follow the main thread, and would a scholar find nothing oversimplified into error?").
- Added scaffolding for a user-selectable response type: exported `ResponseStyleId`, `RESPONSE_STYLES` (`balanced` | `scholar` | `simple` | `concise`), `DEFAULT_RESPONSE_STYLE`, and `buildSystemPrompt(styleId)`. `SYSTEM_PROMPT` is retained as `buildSystemPrompt(DEFAULT_RESPONSE_STYLE)`, so the chat route is unchanged and behavior defaults to Balanced. Wiring a `styleId` through the client → chat route is a follow-up.

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
