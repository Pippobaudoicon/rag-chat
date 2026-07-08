/**
 * Runtime feature flags for the RAG pipeline. Read from the environment so they
 * can be flipped per-deployment without a code change, and overridden directly
 * in the eval harness for A/B measurement.
 */

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "") return fallback;
  if (["1", "true", "on", "yes"].includes(v)) return true;
  if (["0", "false", "off", "no"].includes(v)) return false;
  return fallback;
}

/**
 * Graph-aware reranking (boost chunks that are central in the retrieved
 * cross-reference neighborhood).
 *
 * Default: ON. The eval harness consistently shows it improving ranking (MRR up,
 * zero cases worsened), so it is enabled by default. The flag is retained only as
 * a kill-switch: set `RAG_GRAPH_RERANK=false` to disable without a code change.
 * (The eval harness applies/skips rerank directly, so A/B measurement does not
 * depend on this env var.)
 */
export function isGraphRerankEnabled(): boolean {
  return envBool(process.env.RAG_GRAPH_RERANK, true);
}

/**
 * Hosted cross-encoder reranking (Voyage `rerank-2.5`) over the merged candidate
 * pool. Scores every candidate against the query directly, which calibrates
 * relevance across namespaces/languages that raw Pinecone cosine cannot compare.
 *
 * Default: OFF. It adds an external API call (cost + latency) and should be
 * validated against the eval harness before enabling per-deployment via
 * `RAG_RERANK=true`.
 */
export function isRerankEnabled(): boolean {
  return envBool(process.env.RAG_RERANK, false);
}

/**
 * Diversity pass (per-source / per-title caps) applied after ranking so a single
 * namespace or talk cannot crowd out complementary evidence in the top-k.
 *
 * Default: OFF. Enable per-deployment via `RAG_MMR=true`.
 */
export function isDiversityEnabled(): boolean {
  return envBool(process.env.RAG_MMR, false);
}

/**
 * Multi-query expansion: fan a few LLM-generated phrasings of the query across
 * the namespaces and merge before reranking, to lift recall on topical queries.
 *
 * Default: OFF. Adds one small LLM call per search. Enable via
 * `RAG_MULTI_QUERY=true`.
 */
export function isMultiQueryEnabled(): boolean {
  return envBool(process.env.RAG_MULTI_QUERY, false);
}

/**
 * Eager (speculative) retrieval: for a high-confidence topical, non-scripture
 * turn the route runs the default `semantic_search` retrieval during the
 * pre-stream preamble and injects the chunks into the user message, so the model
 * answers on its first turn instead of spending an empty model turn just to emit
 * a `semantic_search` tool call. The retrieval tools stay exposed for refinement,
 * and the eager call warms the same Upstash cache a redundant tool call would
 * read, so there is no double-retrieval.
 *
 * Default: OFF (opt-in). Enable only once latency traces AND representative
 * output/citation comparisons confirm a net win without quality drift — set
 * `RAG_EAGER_RETRIEVAL=true`. Eligibility is a conservative positive allowlist
 * (`isEagerTopicalQuery`, plus the route's scripture / fixed-chunks / sources
 * gates): chit-chat, response-edit / conversational follow-ups, scripture
 * references, and specific conference-talk requests are all excluded, so the
 * speculative path only fires on genuine topical questions.
 */
export function isEagerRetrievalEnabled(): boolean {
  return envBool(process.env.RAG_EAGER_RETRIEVAL, false);
}

/**
 * Retrieval-query language routing/translation.
 *
 * Default: OFF. The main chat model emits retrieval queries in the corpus
 * language as part of its existing tool call. Set `RAG_LANGUAGE_ROUTING=true`
 * only to restore the legacy dedicated routing-model path.
 */
export function isLanguageRoutingEnabled(): boolean {
  return envBool(process.env.RAG_LANGUAGE_ROUTING, false);
}

/**
 * Nested LLM claim-support audit inside citation_verifier.
 *
 * Default: OFF. Deterministic citation-index validation remains active. Enable
 * only when the extra model call's latency/cost is acceptable.
 */
export function isClaimSupportAuditEnabled(): boolean {
  return envBool(process.env.RAG_CLAIM_SUPPORT_AUDIT, false);
}

/**
 * Compact signature of retrieval flags used in cache keys. Retrieval caches
 * must vary with these flags, otherwise toggling routing / rerank / multi-query
 * / diversity would keep serving stale results until the cache TTL expires.
 * (Graph rerank is applied after the cache read in the tools, so it is not part
 * of the cached retrieval payload and is intentionally excluded here.)
 */
export function retrievalFlagsSignature(): string {
  return `lr${isLanguageRoutingEnabled() ? 1 : 0}rr${
    isRerankEnabled() ? 1 : 0
  }mq${isMultiQueryEnabled() ? 1 : 0}mmr${isDiversityEnabled() ? 1 : 0}ca${
    isClaimSupportAuditEnabled() ? 1 : 0
  }`;
}
