import { filterScripturesByLanguage, retrieve } from "@/lib/rag/retriever";
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
  /** Indexed language required for every scripture chunk in the result. */
  scriptureLanguage: Language;
}

export interface SemanticRetrievalResult {
  /** Ranked chunks, post-expansion and (flag-gated) graph rerank. NOT yet
   * registered for citation indices — the caller owns `context.claimChunks`. */
  chunks: SourceChunk[];
  cacheHit: boolean;
}

/**
 * The retrieval pipeline behind `semantic_search`: `cacheKey → getFromCache →
 * (retrieve + expandRelatedContext + warm setInCache) → graphRerank`.
 * Everything the tool does EXCEPT `context.claimChunks`, which stays with
 * the caller.
 */
export async function runSemanticRetrieval({
  query,
  sources,
  topK,
  language,
  scriptureLanguage,
}: RunSemanticRetrievalParams): Promise<SemanticRetrievalResult> {
  const key = cacheKey(
    query,
    language,
    sources,
    topK,
    `${retrievalFlagsSignature()}sl${scriptureLanguage}`
  );
  const cached = await getFromCache(key);
  const sourceSet = new Set(sources);

  let combined: SourceChunk[];
  if (cached) {
    combined = filterScripturesByLanguage(
      cached.chunks.filter((chunk) => sourceSet.has(chunk.source)),
      scriptureLanguage
    );
  } else {
    const primary = await retrieve(query, sources, language, topK, {
      scriptureLanguage,
    });
    // Attach a bounded slice of each top hit's cross-references / study-help
    // context (the graph projected into Pinecone metadata) for fuller answers.
    const relatedContext = await expandRelatedContext(primary, scriptureLanguage, {
      fromTopN: RELATED_FROM_TOP_N,
      cap: RELATED_CONTEXT_CAP,
      sources,
    });
    combined = filterScripturesByLanguage(
      [...primary, ...relatedContext],
      scriptureLanguage
    );
    void setInCache(key, { chunks: combined });
  }

  // Graph-aware rerank (flag-gated): a chunk cross-referenced by several
  // others in the retrieved neighborhood is central to the topic, so promote
  // it (capped). Falls back to plain vector + expansion order when disabled.
  const chunks = isGraphRerankEnabled()
    ? graphRerank(combined, [], { rerankSeeds: true })
    : combined;

  return { chunks, cacheHit: !!cached };
}
