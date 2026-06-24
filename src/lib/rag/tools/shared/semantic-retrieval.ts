import { retrieve } from "@/lib/rag/retriever";
import { cacheKey, getFromCache, setInCache } from "@/lib/rag/cache";
import { isGraphRerankEnabled, retrievalFlagsSignature } from "@/lib/rag/flags";
import type { Language, SourceChunk, SourceType } from "@/lib/types";
import { expandRelatedContext } from "./related-context";
import { graphRerank } from "./graph-rerank";

// Topical search is already on-target, so graph expansion is deliberately
// conservative: pull cross-references only from the strongest hits and cap the
// total, adding scholar-grade depth without diluting or bloating the payload.
const RELATED_FROM_TOP_N = 4;
const RELATED_CONTEXT_CAP = 8;

export interface RunSemanticRetrievalParams {
  query: string;
  /** Already-resolved source namespaces to query (UI defaults ∩ model override). */
  sources: SourceType[];
  /** Already-resolved per-turn topK. */
  topK: number;
  language: Language;
}

export interface SemanticRetrievalResult {
  /** Ranked chunks, post-expansion and (flag-gated) graph rerank. NOT yet
   * registered for citation indices — the caller owns `context.registerChunks`. */
  chunks: SourceChunk[];
  cacheHit: boolean;
}

/**
 * The shared retrieval pipeline behind `semantic_search` and P1 eager
 * retrieval: `cacheKey → getFromCache → (retrieve + expandRelatedContext +
 * warm setInCache) → graphRerank`. Everything the tool does EXCEPT
 * `context.registerChunks`, which stays with the caller so the same chunks can
 * be registered into the tool context (lazy path) or seeded as `initialChunks`
 * (eager path) with identical ordering and citation indices.
 *
 * Eager and lazy callers MUST pass the same resolved `query`/`sources`/`topK`/
 * `language` so they hit the SAME cacheKey — a redundant tool call after eager
 * retrieval then resolves as a cache hit instead of re-retrieving.
 */
export async function runSemanticRetrieval({
  query,
  sources,
  topK,
  language,
}: RunSemanticRetrievalParams): Promise<SemanticRetrievalResult> {
  const key = cacheKey(query, language, sources, topK, retrievalFlagsSignature());
  const cached = await getFromCache(key);
  const sourceSet = new Set(sources);

  let combined: SourceChunk[];
  if (cached) {
    combined = cached.chunks.filter((chunk) => sourceSet.has(chunk.source));
  } else {
    const primary = await retrieve(query, sources, language, topK);
    // Attach a bounded slice of each top hit's cross-references / study-help
    // context (the graph projected into Pinecone metadata) for fuller answers.
    const relatedContext = await expandRelatedContext(primary, language, {
      fromTopN: RELATED_FROM_TOP_N,
      cap: RELATED_CONTEXT_CAP,
      sources,
    });
    combined = [...primary, ...relatedContext];
    // Best-effort warm cache write; the chat route will overwrite later
    // with the assistant's final answer text.
    void setInCache(key, { chunks: combined, answer: "" });
  }

  // Graph-aware rerank (flag-gated): a chunk cross-referenced by several
  // others in the retrieved neighborhood is central to the topic, so promote
  // it (capped). Falls back to plain vector + expansion order when disabled.
  const chunks = isGraphRerankEnabled()
    ? graphRerank(combined, [], { rerankSeeds: true })
    : combined;

  return { chunks, cacheHit: !!cached };
}
