import type { SourceChunk } from "@/lib/types";

/** Returns chunks deduplicated by `id`, preserving first-seen order. */
export function uniqueById(chunks: SourceChunk[]): SourceChunk[] {
  const seen = new Set<string>();
  const out: SourceChunk[] = [];
  for (const chunk of chunks) {
    if (seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    out.push(chunk);
  }
  return out;
}

/** Trims, drops empties, deduplicates while preserving order. */
export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Shape returned to the model for a single chunk. Text is truncated to keep
 * tool payloads small — the full chunk is still kept server-side for citation
 * mapping and source-card rendering.
 */
export interface ToolChunkPayload {
  id: string;
  citationIndex?: number;
  source: SourceChunk["source"];
  score: number;
  title?: string;
  speaker?: string;
  book?: string;
  chapter?: number;
  verse?: string;
  date?: string;
  section?: string;
  url?: string;
  text: string;
}

const TEXT_PREVIEW_LIMIT = 1200;

export function toToolChunk(chunk: SourceChunk, citationIndex?: number): ToolChunkPayload {
  return {
    id: chunk.id,
    citationIndex,
    source: chunk.source,
    score: chunk.score,
    title: chunk.title,
    speaker: chunk.speaker,
    book: chunk.book,
    chapter: chunk.chapter,
    verse: chunk.verse,
    date: chunk.date,
    section: chunk.section,
    url: chunk.url,
    text:
      chunk.text.length > TEXT_PREVIEW_LIMIT
        ? `${chunk.text.slice(0, TEXT_PREVIEW_LIMIT)}...`
        : chunk.text,
  };
}
