# Tool-specific language routing plan

Status: implementation plan; no runtime behavior changes in this document.

## 1. Goal

Reduce chat time-to-first-text and correct scripture-language selection by
stopping the chat route from translating every prompt before the model can
respond.

Language routing must follow the retrieval operation:

- no retrieval: no translation;
- scripture lookup: prefer the user's language, then fall back to another
  indexed scripture language only when the passage is unavailable;
- semantic search: translate the search query to the English corpus language;
- conference search: translate searchable text to English while preserving
  title, speaker, and year constraints;
- citation verification: no query translation.

This is a latency and correctness change. It must not weaken grounding,
citations, ownership/rate-limit gates, answer-language fidelity, or retrieval
quality.

## 2. Evidence and current mismatch

Baseline queried from `rag_latency_metrics` on 2026-06-24:

- 16 completed `generated` turns;
- server first-text p50: 15,979 ms;
- pre-stream p50: 4,149 ms;
- global language-routing p50: 3,165 ms;
- global language-routing average: 3,775 ms;
- global language-routing p95: 6,734 ms.

Concrete no-tool trace for `Ciao, come stai?`:

- total / answer-ready: 5,420 ms;
- server first text: 4,554 ms;
- pre-stream: 2,997 ms;
- language routing: 2,475 ms;
- model step: 2,419 ms;
- retrieval tools: none.

The route paid an LLM call to translate the greeting to `Hello, how are you?`
even though no retrieval occurred.

There is also a scripture-language contract mismatch:

- `retrieve()` already orders scripture languages with the requested/answer
  language first;
- `POST /api/chat` passes `languageRouting.indexLanguage` to every RAG tool;
- with the default English index, Italian scripture requests therefore prefer
  English even though Italian scripture chunks exist.

## 3. Design principles

1. Do not predict whether the model will use a tool with another LLM call.
2. Translation is lazy: pay for it only inside a tool that needs an
   English-corpus query.
3. Scripture language and semantic-corpus language are separate concepts.
4. Keep one shared translation implementation; do not add multilingual regex
   lists or tool-specific translation prompts.
5. Prefer explicit source policies over a global `RAG_INDEX_LANGUAGE`
   assumption.
6. Preserve the current `/api/search` contract during the chat refactor. Migrate
   it separately after the chat path is verified.
7. Keep eager retrieval default-off. Do not let it reintroduce unconditional
   cross-language routing.

## 4. Target architecture

### 4.1 Turn language context

Add a pure/local prompt-language detector in `language-routing.ts` (or a small
adjacent module) that returns:

```ts
type PromptLanguage = {
  code: string;                 // BCP-47/ISO-639-1 where known, otherwise "und"
  name: string;                 // human-readable answer-language hint
  scriptureLanguage?: Language; // currently "eng" | "ita" when indexed
  confidence?: number;
};
```

Requirements:

- use the existing `tinyld` dependency;
- perform no network call;
- preserve `und` for short/ambiguous input instead of guessing;
- map known indexed scripture languages explicitly (`en -> eng`, `it -> ita`);
- do not equate UI language with prompt language;
- the generation model remains responsible for naturally matching the original
  prompt when local detection is uncertain.

### 4.2 Remove global translation from `POST /api/chat`

The chat preamble must no longer call `routeQueryLanguage()` for every turn.

The route should:

1. detect prompt language locally;
2. load the other independent preamble data as today;
3. build the model message from the original question;
4. expose tools with their source-specific language policy.

`buildUserMessage()` must stop requiring a globally translated `searchQuery`.
It should contain:

- the original question;
- the locally detected answer-language hint when reliable;
- the existing UI-language warning;
- fixed/eager context when applicable.

Do not instruct the model that every tool input must use one global index
language.

### 4.3 Shared lazy retrieval-query router

Keep `routeQueryLanguage()` as the authoritative translation implementation,
but invoke it only when an English-corpus tool executes.

Introduce a request-scoped helper with a narrow contract:

```ts
type RetrievalQueryResolver = {
  resolve(query: string, target: CorpusLanguage): Promise<QueryLanguageRouting>;
};
```

Implementation requirements:

- use the current local same-language fast path;
- memoize by normalized `(query, target)` within the request so repeated
  identical tool calls do not repeat translation;
- preserve scripture references, names, titles, speakers, and years through the
  existing structured routing prompt;
- expose measured routing duration and whether translation occurred;
- fail open exactly as current routing does.

Do not pre-resolve this promise in the route.

### 4.4 Tool policies

#### `semantic_search`

- Accept tool input in the user's/model's natural language.
- Resolve that input to English inside `execute()`.
- Use the resolved English query for cache keys, embeddings, Pinecone, reranking,
  and returned `query` metadata.
- Keep selected-source restrictions and result ordering unchanged.

#### `search_conference_talks`

- Resolve the free-text query and optional title to English before semantic
  retrieval and title matching.
- Preserve speaker names and years.
- Keep deterministic full-talk completion and not-found behavior unchanged.
- Do not translate a speaker/year-only request unnecessarily when the existing
  structured constraints are sufficient; this is an optional optimization only
  if it stays simple and tested.

#### `lookup_scripture_passage`

- Do not translate before lookup.
- Receive a preferred scripture language independently from the semantic index
  language.
- Parse the original reference using language-invariant aliases/slugs.
- Query the preferred language first.
- Fall back through available indexed scripture languages only if the requested
  passage is absent.
- Cache by original normalized reference plus preferred language.
- Return source chunks in one language for a direct passage request unless
  explicitly comparing translations.

For prompt languages not yet present in `INDEXED_LANGUAGES`, use English as the
temporary scripture fallback. Adding French/Spanish/etc. later should require
only registering their corpus code and ingested availability, not changing chat
routing.

#### `citation_verifier`

No language routing. Preserve its existing behavior in this change.

### 4.5 Eager retrieval

`RAG_EAGER_RETRIEVAL` remains default-off.

For this refactor:

- eager retrieval may run only when the original prompt is confidently English
  and the English topical eligibility gate passes;
- do not translate cross-language prompts in the preamble merely to make them
  eager-eligible;
- cross-language topical prompts use the normal tool-first path and translate
  lazily inside `semantic_search`.

This keeps the eager experiment from undoing the main no-global-routing win.

### 4.6 `/api/search`

Do not combine the chat migration with a full search-endpoint redesign.

First implementation PR:

- keep `/api/search` translating to the configured semantic index language;
- preserve its response contract.

Follow-up after chat verification:

- when `sources` is scripture-only and the query is a structured scripture
  reference, use the requested prompt language and skip English translation;
- mixed-source and general semantic searches continue to normalize to English.

## 5. Telemetry

The existing `phases.routing` field currently means global pre-stream routing.
After this change:

- it should be absent or zero for chat turns;
- no-tool turns must have no retrieval-routing event;
- tool-local translation must be visible in retrieval telemetry.

Extend retrieval tool events/details with optional fields such as:

```ts
{
  toolName: "semantic_search",
  routingMs: 2475,
  translated: true,
  inputLanguageCode: "it",
  retrievalLanguage: "eng"
}
```

Keep `tools[].durationMs` inclusive, but record `routingMs` separately so
translation and Pinecone latency can be distinguished.

Add a Grafana query/panel or documented query for:

- routing calls per tool;
- routing p50/p95 by tool;
- no-tool server-first-text p50/p95;
- scripture result language by input language;
- total AI Gateway requests per completed chat turn where available.

## 6. Implementation sequence

### Phase A — local context and lazy resolver

1. Extract local prompt-language detection.
2. Add the request-scoped memoized retrieval-query resolver.
3. Unit-test identity, translation, fallback, and memoization.

Verification: no route behavior change yet; existing routing tests pass.

### Phase B — chat route and prompt contract

1. Remove global `routeQueryLanguage()` from the chat preamble.
2. Update answer-cache language metadata to use local prompt language.
3. Simplify `buildUserMessage()` to use the original question.
4. Update system/tool prompts to state each tool handles its retrieval language.
5. Keep auth, billing, rate-limit, ownership, history, memory, and write ordering
   unchanged.

Verification: a no-tool Italian greeting records no routing LLM call.

### Phase C — tool-specific policies

1. Move English normalization into `semantic_search`.
2. Move conference normalization into `search_conference_talks`.
3. Pass preferred scripture language to `lookup_scripture_passage`.
4. Record tool-local routing telemetry.

Verification: retrieval ranking and payload shape remain unchanged for English
semantic queries; Italian scripture requests return Italian chunks.

### Phase D — evaluation and rollout

1. Run all local gates.
2. Run retrieval eval, especially cross-language and scripture-language cases.
3. Deploy behind a temporary default-off flag only if a safe incremental rollout
   is needed; otherwise the architecture itself should be the default because
   no-tool turns cannot require retrieval translation.
4. Compare release-tagged metrics.

## 7. Required tests

Add a focused `npm run test:language-policy` suite covering:

- `Ciao, come stai?` -> local Italian answer hint, zero translation calls;
- `Thanks, that helps` -> zero translation calls;
- English topical semantic query -> identity routing inside
  `semantic_search`;
- Italian topical semantic query -> one English translation inside
  `semantic_search`;
- repeated identical semantic tool input -> one memoized translation;
- Italian `Giovanni 3:16` -> Italian scripture chunks first, no English
  translation call;
- English `John 3:16` -> English scripture chunks first;
- missing preferred scripture language -> deterministic fallback;
- Italian conference title/speaker/year request -> English retrieval query with
  constraints preserved;
- citation indices and response source ordering unchanged;
- regenerate with fixed chunks -> no translation unless a refinement tool runs;
- answer-cache hit -> no translation;
- eager default-off -> no pre-stream translation;
- `/api/search` existing contract unchanged.

Also run:

```bash
npm run typecheck
npm run docs:guard
npm run test:routing
npm run test:eager
npm run test:language-policy
npm run eval
npm run build
git diff --check development...HEAD
```

## 8. Success criteria

Correctness:

- no-tool turns issue zero language-routing LLM calls;
- direct scripture references prefer the prompt language when that scripture
  language is indexed;
- semantic and conference retrieval still target the English corpus;
- answer language, retrieval ranking, IDs, totals, source ordering, citations,
  cache isolation, and API payload shapes do not regress.

Latency:

- the `Ciao, come stai?` class of no-tool turns removes the observed ~2.5s
  routing call;
- no-tool server-first-text p50 improves by at least 1.5s or 30%;
- global chat `phases.routing` disappears from the pre-stream critical path;
- semantic retrieval turns do not add more than one translation call per unique
  tool query;
- scripture-reference turns do not pay for English translation.

Reliability:

- translation failure remains fail-open;
- unsupported prompt languages fall back deterministically;
- no new external service or dependency;
- no multilingual regex lists.

## 9. Non-goals

- Do not redesign embeddings or Pinecone namespaces.
- Do not ingest new scripture languages in this PR.
- Do not optimize or remove `citation_verifier` in this PR.
- Do not enable eager retrieval by default.
- Do not change answer style, citation format, billing, or rate-limit behavior.

## 10. Review checkpoints

Stop and request review after:

1. the lazy resolver and local detector are implemented;
2. global chat routing is removed but before tool policies are migrated;
3. scripture-language tests pass;
4. production/preview metrics are collected.

If the implementation requires multilingual heuristics, a second classifier
LLM call, or duplicated routing logic per tool, the design has drifted and
should be simplified before continuing.
