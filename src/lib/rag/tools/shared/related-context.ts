import { fetchRelatedChunks } from "@/lib/rag/retriever";
import type { Language, SourceChunk, SourceType } from "@/lib/types";

export interface ExpandRelatedOptions {
  /** Only collect related ids from the first N (highest-ranked) chunks. */
  fromTopN?: number;
  /** Hard cap on the number of related ids fetched. */
  cap: number;
  /** Optional source allow-list for related chunks. */
  sources?: SourceType[];
}

/**
 * Expand a set of retrieved chunks with their cross-reference graph: the
 * footnote / Topical-Guide / Bible-Dictionary links and cited passages stored
 * in each chunk's `relatedIds` (projected from the lds-scraper graph into
 * Pinecone metadata). This gives the model the surrounding scriptural web +
 * study-help context for fuller, scholar-grade answers.
 *
 * Returns only the *new* chunks (deduped against the input ids). Bounded by
 * `fromTopN` (which source chunks contribute ids) and `cap` (total ids
 * fetched) so it adds depth without blowing up the tool payload.
 */
export async function expandRelatedContext(
  chunks: SourceChunk[],
  language: Language,
  { fromTopN, cap, sources }: ExpandRelatedOptions
): Promise<SourceChunk[]> {
  if (chunks.length === 0 || cap <= 0) return [];
  const sourceIds = new Set(chunks.map((chunk) => chunk.id));
  const allowedSources = sources ? new Set(sources) : null;
  const seeds = fromTopN ? chunks.slice(0, fromTopN) : chunks;

  const relatedIds: string[] = [];
  const seen = new Set<string>();
  for (const chunk of seeds) {
    for (const relatedId of chunk.relatedIds ?? []) {
      if (sourceIds.has(relatedId) || seen.has(relatedId)) continue;
      seen.add(relatedId);
      relatedIds.push(relatedId);
      if (relatedIds.length >= cap) break;
    }
    if (relatedIds.length >= cap) break;
  }

  if (relatedIds.length === 0) return [];
  const related = await fetchRelatedChunks(relatedIds, language);
  return related.filter(
    (chunk) => !sourceIds.has(chunk.id) && (!allowedSources || allowedSources.has(chunk.source))
  );
}
