import type { SourceChunk } from "@/lib/types";
import { uniqueById } from "./chunk-formatting";

/** Listener invoked whenever a tool registers new chunks for the response. */
export type ToolSourceListener = (chunks: SourceChunk[]) => void;

/** A chunk together with the 1-based citation index assigned for this turn. */
export interface IndexedToolChunk {
  chunk: SourceChunk;
  citationIndex: number;
}

/**
 * Per-request context shared by every RAG tool in a single chat turn.
 *
 * Responsibilities:
 *   - Track the canonical ordered list of chunks the model has been shown so
 *     that citation indices stay stable across multiple tool calls.
 *   - Hand out monotonically-increasing `citationIndex` values when a tool
 *     introduces new chunks.
 *   - Surface added chunks to the route via `onSources` so they can be
 *     persisted and rendered as source cards.
 */
export interface RagToolContext {
  /** Current snapshot of the chunks that have been registered this turn. */
  liveChunks(): SourceChunk[];
  /** Total number of registered chunks (== max valid citation index). */
  citationCount(): number;
  /**
   * Register a batch of chunks for the current response. Returns each chunk
   * paired with the citation index the model should use when citing it.
   */
  registerChunks(chunks: SourceChunk[]): IndexedToolChunk[];
}

export interface CreateRagToolContextOptions {
  /** Chunks already injected into the user message (legacy eager retrieval). */
  initialChunks?: SourceChunk[];
  /** Notified whenever new chunks are added by a tool call. */
  onSources?: ToolSourceListener;
}

export function createRagToolContext(
  options: CreateRagToolContextOptions = {}
): RagToolContext {
  let live = uniqueById(options.initialChunks ?? []);
  const onSources = options.onSources;

  return {
    liveChunks: () => live,
    citationCount: () => live.length,
    registerChunks(chunks) {
      const next = [...live];
      const indexed = chunks.map((chunk) => {
        const existingIndex = next.findIndex((existing) => existing.id === chunk.id);
        if (existingIndex >= 0) {
          return { chunk, citationIndex: existingIndex + 1 };
        }
        next.push(chunk);
        return { chunk, citationIndex: next.length };
      });
      live = next;
      onSources?.(chunks);
      return indexed;
    },
  };
}
