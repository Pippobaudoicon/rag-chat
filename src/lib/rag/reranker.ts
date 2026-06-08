// Voyage AI reranker via direct REST (mirrors embedder.ts — no SDK needed).
//
// A cross-encoder scores every candidate against the query directly, so its
// relevance scores ARE comparable across namespaces and languages — unlike raw
// Pinecone cosine, where a 0.62 in `conference` is not worth a 0.62 in
// `gospel_study`. Gated behind RAG_RERANK; see flags.ts.

import type { SourceChunk } from "@/lib/types";

const VOYAGE_RERANK_URL = "https://api.voyageai.com/v1/rerank";
export const VOYAGE_RERANK_MODEL = "rerank-2.5";

// Cap the candidate pool and per-document length sent to the reranker so the
// request stays well under Voyage's context limit and latency stays bounded.
// Chunks beyond the cap keep their existing order and are appended unscored.
const MAX_RERANK_CANDIDATES = 100;
const MAX_DOC_CHARS = 1600;

interface VoyageRerankResponse {
  data?: { index: number; relevance_score: number }[];
}

/**
 * Reorder `chunks` by cross-encoder relevance to `query`, writing each chunk's
 * `relevance_score` onto `score` so it becomes the primary sort key downstream
 * (topic/entity boost and the language tiebreak then act as small secondary
 * nudges).
 *
 * Reranking is a quality enhancement, not a correctness requirement: on any API
 * error or empty response it falls back to the input order rather than failing
 * the search.
 */
export async function rerankChunks(
  query: string,
  chunks: SourceChunk[]
): Promise<SourceChunk[]> {
  if (chunks.length <= 1) return chunks;

  // Sort by current (cosine) score first so we rerank the GLOBALLY strongest
  // candidates, not whatever happened to arrive first in the namespace /
  // multi-query fan-out (which is grouped, not globally score-ordered). Rerank
  // at most MAX_RERANK_CANDIDATES; the beyond-cap remainder is kept but demoted
  // below all reranked chunks (see below).
  const ordered = [...chunks].sort((a, b) => b.score - a.score);
  const pool = ordered.slice(0, MAX_RERANK_CANDIDATES);
  const tail = ordered.slice(MAX_RERANK_CANDIDATES);
  const documents = pool.map((chunk) => (chunk.text ?? "").slice(0, MAX_DOC_CHARS));

  let response: Response;
  try {
    response = await fetch(VOYAGE_RERANK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VOYAGE_RERANK_MODEL,
        query,
        documents,
        truncation: true,
      }),
    });
  } catch (error) {
    console.error("Voyage rerank request failed; keeping input order", error);
    return chunks;
  }

  if (!response.ok) {
    console.error(`Voyage rerank error ${response.status}: ${await response.text()}`);
    return chunks;
  }

  const data = (await response.json()) as VoyageRerankResponse;
  const results = data.data ?? [];
  if (results.length === 0) return chunks;

  const reranked = results
    .filter((r) => r.index >= 0 && r.index < pool.length)
    .map((r) => ({ ...pool[r.index], score: r.relevance_score }))
    .sort((a, b) => b.score - a.score);

  if (reranked.length === 0) return chunks;

  // Anything not given a relevance score (Voyage omissions + the beyond-cap
  // tail) MUST rank below every reranked chunk: their cosine scores are on a
  // different scale than Voyage relevance and would otherwise interleave (a tail
  // chunk at cosine 0.85 could outrank a reranked chunk at relevance 0.5).
  // Demote them just under the lowest relevance score, preserving their order.
  const scoredIds = new Set(reranked.map((chunk) => chunk.id));
  const leftover = [...pool.filter((chunk) => !scoredIds.has(chunk.id)), ...tail];
  const floor = reranked[reranked.length - 1].score;
  const demoted = leftover.map((chunk, i) => ({ ...chunk, score: floor - (i + 1) * 1e-4 }));

  return [...reranked, ...demoted];
}
