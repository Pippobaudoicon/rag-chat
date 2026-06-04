import type { SourceChunk } from "@/lib/types";

/**
 * Graph-aware reranking over the cross-reference graph projected into Pinecone
 * metadata (`relatedIds`). This is the multi-hop signal: a candidate passage or
 * study-help that is cross-referenced by *several* of the retrieved chunks is
 * central to the query's scriptural neighborhood, so it deserves to surface.
 *
 * We never ship the 60MB sidecar graph to the runtime — every vector already
 * carries its forward edges in metadata, and the expansion step pulls in hop-2
 * chunks (which carry their own edges too), so connectivity among the retrieved
 * set is fully observable here.
 *
 * The boost is small and capped (like the topic/entity rerank) so it acts as a
 * principled tiebreaker among semantically-close candidates rather than
 * overriding vector relevance.
 */

// Max score added by graph centrality. Kept below typical vector-score gaps so
// it only reorders near-ties.
const GRAPH_BOOST_CAP = 0.06;
// Weight of a reference coming from a primary (seed) chunk vs. an expanded one.
const SEED_REF_WEIGHT = 1;
const EXPANDED_REF_WEIGHT = 0.4;
// Centrality (weighted in-references) needed to reach the cap. ~2 seed refs.
const CENTRALITY_FOR_CAP = 2;

export interface GraphRerankOptions {
  /**
   * When true, the seeds are reordered together with the expanded chunks
   * (use for topical search). When false, seeds keep their vector order and
   * only the expanded chunks are reranked among themselves (use for a
   * scripture-passage lookup, where the requested passage must stay on top).
   */
  rerankSeeds: boolean;
}

function centralityBoost(weightedRefs: number): number {
  if (weightedRefs <= 0) return 0;
  const scaled = (weightedRefs / CENTRALITY_FOR_CAP) * GRAPH_BOOST_CAP;
  return Math.min(GRAPH_BOOST_CAP, scaled);
}

/**
 * Returns the combined seed + expanded chunks reranked by graph centrality.
 * Each chunk's `score` is adjusted by its (capped) centrality boost so the
 * ordering is transparent downstream. Deduped by id (seeds win over expanded).
 */
export function graphRerank(
  seeds: SourceChunk[],
  expanded: SourceChunk[],
  { rerankSeeds }: GraphRerankOptions
): SourceChunk[] {
  // Dedupe: a seed and an expanded chunk should never collide (expansion filters
  // seed ids), but guard anyway so a chunk is scored once.
  const seenIds = new Set(seeds.map((c) => c.id));
  const uniqueExpanded = expanded.filter((c) => !seenIds.has(c.id));

  if (uniqueExpanded.length === 0 && !rerankSeeds) return seeds;

  // Tally weighted in-references across the whole local subgraph.
  const refWeight = new Map<string, number>();
  const tally = (chunks: SourceChunk[], weight: number) => {
    for (const chunk of chunks) {
      for (const relatedId of chunk.relatedIds ?? []) {
        refWeight.set(relatedId, (refWeight.get(relatedId) ?? 0) + weight);
      }
    }
  };
  tally(seeds, SEED_REF_WEIGHT);
  tally(uniqueExpanded, EXPANDED_REF_WEIGHT);

  const boosted = (chunk: SourceChunk): SourceChunk => {
    const boost = centralityBoost(refWeight.get(chunk.id) ?? 0);
    return boost > 0 ? { ...chunk, score: chunk.score + boost } : chunk;
  };

  // Stable sort by adjusted score (preserves input order on ties).
  const byScore = (a: SourceChunk, b: SourceChunk) => b.score - a.score;

  if (rerankSeeds) {
    return [...seeds, ...uniqueExpanded].map(boosted).sort(byScore);
  }
  // Keep the requested passage on top; only reorder the supporting context.
  const rerankedExpanded = uniqueExpanded.map(boosted).sort(byScore);
  return [...seeds, ...rerankedExpanded];
}
