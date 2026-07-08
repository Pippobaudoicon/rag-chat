import { tool } from "ai";
import { z } from "zod";
import { SUPER_SOURCES } from "@/lib/types";
import type { ChatProgressData, Language, SourceType } from "@/lib/types";
import {
  aggregateRoutingTelemetry,
  type RetrievalQueryResolver,
} from "@/lib/rag/retrieval-query-resolver";
import { toToolChunk } from "../shared/chunk-formatting";
import { runSemanticRetrieval } from "../shared/semantic-retrieval";
import type { RagToolContext } from "../shared/tool-context";

const SOURCE_VALUES: SourceType[] = SUPER_SOURCES;

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("Free-text query for general topical retrieval across selected sources"),
  scriptureLanguage: z
    .enum(["eng", "ita"])
    .describe(
      "Indexed scripture language matching the user's original prompt: ita for Italian, eng for English or unsupported languages"
    ),
  topK: z
    .number()
    .int()
    .min(1)
    .max(40)
    .optional()
    .describe(
      "Optional upper bound on chunks to return. Defaults to the per-turn topK chosen in the chat UI."
    ),
  sources: z
    .array(z.enum(SOURCE_VALUES as [SourceType, ...SourceType[]]))
    .min(1)
    .optional()
    .describe(
      "Optional override of the source namespaces to query. Defaults to the per-turn sources chosen in the chat UI."
    ),
});

export interface SemanticSearchDeps {
  /** Semantic corpus language to retrieve against (English by default). */
  language: Language;
  /** Query resolver: passthrough by default, legacy translation when enabled. */
  resolver: RetrievalQueryResolver;
  /** Sources selected in the chat UI for this turn. */
  defaultSources: SourceType[];
  /** topK selected in the chat UI for this turn. */
  defaultTopK: number;
  context: RagToolContext;
  onProgress?: (progress: ChatProgressData) => void;
}

/**
 * `semantic_search`: general-purpose RAG retrieval. This is the tool the model
 * should call for any topical question that does not have a more specific
 * tool (scripture reference → `lookup_scripture_passage`, talk title /
 * speaker → `search_conference_talks`).
 *
 * The tool wraps {@link retrieve} and uses the same Upstash-backed cache that
 * the route used to call eagerly. This keeps latency parity with the previous
 * eager-retrieval design while ensuring retrieval only runs when the model
 * actually needs it.
 *
 * Defaults `sources` and `topK` to the values the user picked in the UI for
 * this turn. The model can override them when it is confident that a wider or
 * narrower scope would help (e.g. forcing `["scriptures"]` for a doctrinal
 * cross-reference search).
 */
export function createSemanticSearchTool({
  language,
  resolver,
  defaultSources,
  defaultTopK,
  context,
  onProgress,
}: SemanticSearchDeps) {
  // Ceiling for the model's `sources` override = exactly what the user enabled in
  // the UI. "Super" is explicit: it sends the full SUPER_SOURCES set, so that case
  // is already covered without special-casing. (Previously, selecting all 5 VISIBLE
  // toggles — ALL_SOURCES.length — was mis-read as Super and silently unlocked the
  // hidden namespaces the user never picked.)
  const allowedSources = new Set<SourceType>(defaultSources);
  const corpusLanguage = language === "eng" ? "English" : "Italian";

  return tool({
    description: `Run a general semantic search across the user's selected LDS sources. Pass the query in ${corpusLanguage}; translate it yourself from the user's language while preserving names and scripture references. Use this when the question is topical and does not target a specific scripture reference or conference talk. Returns ranked chunks with citation indices.`,
    inputSchema,
    execute: async ({ query, scriptureLanguage, topK, sources }) => {
      const startedAt = Date.now();
      const effectiveScriptureLanguage =
        context.resolveScriptureLanguage(scriptureLanguage);
      const effectiveTopK = topK ?? defaultTopK;
      const requestedSources = sources && sources.length > 0 ? sources : defaultSources;
      const filteredSources = requestedSources.filter((source) => allowedSources.has(source));
      const effectiveSources = filteredSources.length > 0 ? filteredSources : defaultSources;

      onProgress?.({
        phase: "sources",
        toolName: "semantic_search",
      });

      // Lazy translation to the corpus language. The local same-language fast
      // path makes an English query identity (no LLM call); a cross-language
      // query is translated once (memoized per request). The resolved English
      // query drives the cache key, embeddings, Pinecone, rerank, and returned
      // `query` metadata so retrieval is identical to the old pre-translated path.
      const routing = await resolver.resolve(query, language);
      const retrievalQuery = routing.searchQuery;

      const { chunks, cacheHit } = await runSemanticRetrieval({
        query: retrievalQuery,
        sources: effectiveSources,
        topK: effectiveTopK,
        language,
        scriptureLanguage: effectiveScriptureLanguage,
      });

      const indexedChunks = context.registerChunks(chunks);
      onProgress?.({
        phase: "tools",
        toolName: "semantic_search",
        sourceCount: indexedChunks.length,
        cacheHit,
        elapsedMs: Date.now() - startedAt,
        retrievalLanguage: language,
        ...aggregateRoutingTelemetry([routing]),
      });

      return {
        query: retrievalQuery,
        language,
        sources: effectiveSources,
        cacheHit,
        total: indexedChunks.length,
        chunks: indexedChunks.map(({ chunk, citationIndex }) =>
          toToolChunk(chunk, citationIndex)
        ),
      };
    },
  });
}
