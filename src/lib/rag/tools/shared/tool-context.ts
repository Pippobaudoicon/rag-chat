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
  /** Lock all scripture-producing tools to one language for this turn. */
  resolveScriptureLanguage(requested: Language): Language;
  /**
   * Register a tool call's chunks for the current response. Returns the newly
   * added chunks paired with the citation index the model should use.
   *
   * Parallel calls wait for each other (see `trackCall`) and then share the
   * source cap round-robin, lower `priority` first. That way no call is starved
   * by a faster or longer one: a requested passage and topical context both get
   * slots.
   */
  claimChunks(chunks: SourceChunk[], priority: number): Promise<IndexedToolChunk[]>;
  /** Run a tool execution as part of the current round. `claimChunks` waits for every tracked call. */
  trackCall<T>(run: () => Promise<T>): Promise<T>;
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
  let inFlight = 0;
  let waiting: {
    chunks: SourceChunk[];
    priority: number;
    resolve: (indexed: IndexedToolChunk[]) => void;
  }[] = [];

  const registerChunks = (chunks: SourceChunk[]): IndexedToolChunk[] => {
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
  };

  // Once every in-flight call has claimed (or failed), deal the free slots one
  // chunk per call in turn. Untracked callers (inFlight 0) register at once.
  const flush = () => {
    if (waiting.length === 0 || waiting.length < inFlight) return;
    const round = waiting.sort((a, b) => a.priority - b.priority);
    waiting = [];
    const seen = new Set(live.map((chunk) => chunk.id));
    const picks = round.map(() => [] as SourceChunk[]);
    const cursors = round.map(() => 0);
    let room = maxChunks - live.length;
    for (let progressed = true; room > 0 && progressed; ) {
      progressed = false;
      round.forEach(({ chunks }, i) => {
        while (room > 0 && cursors[i] < chunks.length) {
          const chunk = chunks[cursors[i]++];
          if (seen.has(chunk.id)) continue;
          seen.add(chunk.id);
          picks[i].push(chunk);
          room -= 1;
          progressed = true;
          break;
        }
      });
    }
    round.forEach((call, i) => call.resolve(registerChunks(picks[i])));
  };

  return {
    resolveScriptureLanguage(requested) {
      scriptureLanguage ??= requested;
      return scriptureLanguage;
    },
    claimChunks(chunks, priority) {
      return new Promise((resolve) => {
        waiting.push({ chunks, priority, resolve });
        flush();
      });
    },
    async trackCall(run) {
      inFlight += 1;
      try {
        return await run();
      } finally {
        inFlight -= 1;
        flush();
      }
    },
  };
}
