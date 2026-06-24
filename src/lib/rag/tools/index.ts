import type { ChatProgressData, Language, SourceChunk, SourceType } from "@/lib/types";
import type { RetrievalQueryResolver } from "@/lib/rag/retrieval-query-resolver";
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
  /** Semantic corpus language (English by default) — the target for semantic /
   *  conference retrieval after lazy translation. */
  language: Language;
  /**
   * Preferred scripture language for `lookup_scripture_passage`, chosen from the
   * prompt language independently of the semantic `language` (scriptures are
   * bilingual; the retriever falls back to the other indexed language if empty).
   */
  scriptureLanguage: Language;
  /**
   * Request-scoped lazy translation resolver. `semantic_search` and
   * `search_conference_talks` use it to translate their query to `language`
   * inside `execute()`; identical queries within the turn are memoized.
   */
  resolver: RetrievalQueryResolver;
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
 *   - `citation_verifier` — validates inline `[N]` markers before sending the
 *     final answer.
 */
export function createRagTools(options: CreateRagToolsOptions) {
  const {
    language,
    scriptureLanguage,
    resolver,
    sources,
    topK,
    initialChunks,
    onSources,
    onProgress,
  } = options;

  const context = createRagToolContext({ initialChunks, onSources });

  return {
    semantic_search: createSemanticSearchTool({
      language,
      resolver,
      defaultSources: sources,
      defaultTopK: topK,
      context,
      onProgress,
    }),
    lookup_scripture_passage: createLookupScripturePassageTool({ scriptureLanguage, context, onProgress }),
    search_conference_talks: createSearchConferenceTalksTool({ language, resolver, context, onProgress }),
    citation_verifier: createCitationVerifierTool({ context }),
  };
}
