import type { Language, SourceChunk } from "@/lib/types";
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
  /** Lock all scripture-producing tools to one language for this turn. */
  resolveScriptureLanguage(requested: Language): Language;
  /**
   * Register a batch of chunks for the current response. Returns newly added
   * chunks paired with the citation index the model should use when citing it.
   */
  registerChunks(chunks: SourceChunk[]): IndexedToolChunk[];
}

export interface CreateRagToolContextOptions {
  /** Chunks already injected into the user message (legacy eager retrieval). */
  initialChunks?: SourceChunk[];
  /** Maximum number of unique chunks exposed to the model in this turn. */
  maxChunks?: number;
  /** Notified whenever new chunks are added by a tool call. */
  onSources?: ToolSourceListener;
}

export function createRagToolContext(
  options: CreateRagToolContextOptions = {}
): RagToolContext {
  const maxChunks = options.maxChunks ?? Number.POSITIVE_INFINITY;
  let live = uniqueById(options.initialChunks ?? []).slice(0, maxChunks);
  let scriptureLanguage = live.find(
    (chunk) => chunk.source === "scriptures"
  )?.language;
  const onSources = options.onSources;

  return {
    liveChunks: () => live,
    citationCount: () => live.length,
    resolveScriptureLanguage(requested) {
      scriptureLanguage ??= requested;
      return scriptureLanguage;
    },
    registerChunks(chunks) {
      const next = [...live];
      const added: SourceChunk[] = [];
      const indexed: IndexedToolChunk[] = [];
      for (const chunk of chunks) {
        const existingIndex = next.findIndex((existing) => existing.id === chunk.id);
        if (existingIndex >= 0) continue;
        if (next.length >= maxChunks) continue;
        next.push(chunk);
        added.push(chunk);
        indexed.push({ chunk, citationIndex: next.length });
      }
      live = next;
      if (added.length > 0) onSources?.(added);
      return indexed;
    },
  };
}
