import type { ChatProgressData, Language, SourceChunk, SourceType } from "@/lib/types";
import { createLookupScripturePassageTool } from "./lookup-scripture-passage/tool";
import { createSearchConferenceTalksTool } from "./search-conference-talks/tool";
import { createSemanticSearchTool } from "./semantic-search/tool";
import { withToolCallBudget } from "./shared/tool-call-budget";
import {
  createRagToolContext,
  type ToolSourceListener,
} from "./shared/tool-context";

export type { RagToolContext, ToolSourceListener } from "./shared/tool-context";

export interface CreateRagToolsOptions {
  /** Semantic corpus language (English by default) expected in semantic /
   * conference tool arguments. */
  language: Language;
  /** Sources selected in the chat UI for this turn. */
  sources: SourceType[];
  /** topK selected in the chat UI for this turn. */
  topK: number;
  /**
   * Chunks already injected into the user message via legacy eager retrieval.
   * Pass an empty array when the route relies on tools for all retrieval.
   */
  initialChunks?: SourceChunk[];
  /** Maximum number of unique chunks exposed to the model in this turn. */
  maxChunks?: number;
  /** Maximum `semantic_search` executions in the turn (specific lookups are not counted). */
  maxRetrievalCalls?: number;
  /** Notified whenever a tool registers new chunks for the response. */
  onSources?: ToolSourceListener;
  /** Notified as tools start and finish so the UI can show live progress. */
  onProgress?: (progress: ChatProgressData) => void;
}

/**
 * Build the RAG tool set for a single chat turn.
 *
 * All tools share a {@link RagToolContext} so that citation indices stay
 * stable across multiple tool calls within the same turn — a chunk first
 * surfaced by `semantic_search` keeps its index even if `lookup_scripture_passage`
 * later returns the same chunk.
 *
 * Tools exposed:
 *   - `semantic_search` — general topical retrieval (default for any
 *     non-specialized question).
 *   - `lookup_scripture_passage` — scripture-by-reference retrieval.
 *   - `search_conference_talks` — conference-talk retrieval with optional
 *     speaker / year / title filters.
 */
export function createRagTools(options: CreateRagToolsOptions) {
  const {
    language,
    sources,
    topK,
    initialChunks,
    maxChunks,
    maxRetrievalCalls,
    onSources,
    onProgress,
  } = options;

  const context = createRagToolContext({ initialChunks, maxChunks, onSources });

  // Parallel calls in the round share the source cap (see claimChunks). The round
  // waits for every tool anyway, so this adds no latency. ponytail: only calls
  // already started are awaited; a call emitted after the others claimed gets
  // what is left (tool calls stream in milliseconds apart, retrieval takes ~1 s).
  const tracked = <T extends { execute?: unknown }>(toolDef: T): T => {
    const execute = toolDef.execute as (...args: unknown[]) => Promise<unknown>;
    return { ...toolDef, execute: (...args: unknown[]) => context.trackCall(() => execute(...args)) };
  };

  const tools = {
    semantic_search: tracked(
      createSemanticSearchTool({
        language,
        defaultSources: sources,
        defaultTopK: topK,
        context,
        onProgress,
      })
    ),
    lookup_scripture_passage: tracked(createLookupScripturePassageTool({ context, onProgress })),
    search_conference_talks: tracked(
      createSearchConferenceTalksTool({ language, context, onProgress })
    ),
  };

  // Only topical search counts against the budget: a specific lookup is what the
  // user asked for, so it always runs (still within the single retrieval round)
  // and gets its share of the cap.
  return withToolCallBudget(tools, ["semantic_search"], maxRetrievalCalls);
}
