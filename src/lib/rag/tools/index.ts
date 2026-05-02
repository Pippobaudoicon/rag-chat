import type { Language, SourceChunk, SourceType } from "@/lib/types";
import { createCitationVerifierTool } from "./citation-verifier/tool";
import { createLookupScripturePassageTool } from "./lookup-scripture-passage/tool";
import { createSearchConferenceTalksTool } from "./search-conference-talks/tool";
import { createSemanticSearchTool } from "./semantic-search/tool";
import {
  createRagToolContext,
  type RagToolContext,
  type ToolSourceListener,
} from "./shared/tool-context";

export type { RagToolContext, ToolSourceListener } from "./shared/tool-context";

export interface CreateRagToolsOptions {
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
  /** Notified whenever a tool registers new chunks for the response. */
  onSources?: ToolSourceListener;
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
 *   - `citation_verifier` — validates inline `[N]` markers before sending the
 *     final answer.
 */
export function createRagTools(options: CreateRagToolsOptions) {
  const { language, sources, topK, initialChunks, onSources } = options;

  const context = createRagToolContext({ initialChunks, onSources });

  return {
    semantic_search: createSemanticSearchTool({
      language,
      defaultSources: sources,
      defaultTopK: topK,
      context,
    }),
    lookup_scripture_passage: createLookupScripturePassageTool({ language, context }),
    search_conference_talks: createSearchConferenceTalksTool({ language, context }),
    citation_verifier: createCitationVerifierTool({ context }),
  };
}
