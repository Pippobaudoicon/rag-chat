import { fetchRelatedChunks, fetchLocalizedScriptureRefs } from "@/lib/rag/retriever";
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
  // Cross-reference edges are stored as ENGLISH ids in the graph. Resolve them in
  // the passage language by rewriting the id's language segment, so an Italian
  // passage gets Italian cross-reference chunks (not English ones the
  // single-language filter would then drop). English passages: no-op.
  const localized = relatedIds.map((id) => localizeScriptureId(id, language));
  const related = await fetchRelatedChunks(localized, language);

  // Exact-id fetch misses a scripture ref when the target language chunked the
  // same verses into a different range. Resolve those by canonical slug+chapter
  // + verse overlap (no-op for English, where the exact ids all exist).
  const found = new Set(related.map((chunk) => chunk.id));
  const missedScripture = localized.filter(
    (id) => id.startsWith("scriptures:") && !found.has(id)
  );
  if (missedScripture.length > 0) {
    related.push(...(await fetchLocalizedScriptureRefs(missedScripture, language)));
  }

  const emitted = new Set<string>();
  return related
    .filter((chunk) => {
      if (sourceIds.has(chunk.id) || emitted.has(chunk.id)) return false;
      emitted.add(chunk.id);
      return !allowedSources || allowedSources.has(chunk.source);
    })
    // Slug+chapter resolution can return several chunks per missed ref, so re-cap
    // (exact-id matches are first, so they're kept).
    .slice(0, cap);
}

/**
 * Rewrite a scripture chunk id's language segment (`scriptures:<lang>:<slug>:…`)
 * to `language` — pure canonical-slug remap, no translation. Non-scripture ids
 * (study helps, English-only in the graph) are returned unchanged. Refs whose
 * exact verse-range id is absent in the target language are recovered by
 * `fetchLocalizedScriptureRefs` (slug+chapter + verse overlap).
 */
export function localizeScriptureId(id: string, language: Language): string {
  const parts = id.split(":");
  if (parts[0] !== "scriptures" || parts.length < 3) return id;
  parts[1] = language;
  return parts.join(":");
}

/**
 * Keep only related chunks in `language`. The cross-reference graph's
 * `related_ids` are projected onto ENGLISH chunks only, so expanding a
 * non-English passage can surface English cross-references — which would break
 * the single-language direct-passage contract (`lookup_scripture_passage`).
 * Filtering to the passage's own language drops that cross-language leakage.
 */
export function filterRelatedToLanguage(
  related: SourceChunk[],
  language: Language
): SourceChunk[] {
  return related.filter((chunk) => chunk.language === language);
}
