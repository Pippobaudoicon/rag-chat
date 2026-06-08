import { tool } from "ai";
import { z } from "zod";
import { retrieve } from "@/lib/rag/retriever";
import { cacheKey, getFromCache, setInCache } from "@/lib/rag/cache";
import { SUPER_SOURCES } from "@/lib/types";
import type { ChatProgressData, Language, SourceChunk, SourceType } from "@/lib/types";
import { toToolChunk } from "../shared/chunk-formatting";
import { expandRelatedContext } from "../shared/related-context";
import { graphRerank } from "../shared/graph-rerank";
import { isGraphRerankEnabled, retrievalFlagsSignature } from "@/lib/rag/flags";
import type { RagToolContext } from "../shared/tool-context";

const SOURCE_VALUES: SourceType[] = SUPER_SOURCES;

// Topical search is already on-target, so graph expansion is deliberately
// conservative: pull cross-references only from the strongest hits and cap the
// total, adding scholar-grade depth without diluting or bloating the payload.
const RELATED_FROM_TOP_N = 4;
const RELATED_CONTEXT_CAP = 8;

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("Free-text query for general topical retrieval across selected sources"),
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
  language: Language;
  /** Sources selected in the chat UI for this turn. */
  defaultSources: SourceType[];
  /** topK selected in the chat UI for this turn. */
  defaultTopK: number;
  context: RagToolContext;
  onProgress?: (progress: ChatProgressData) => void;
  retrievalLanguageName?: string;
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
  defaultSources,
  defaultTopK,
  context,
  onProgress,
  retrievalLanguageName = "the configured index language",
}: SemanticSearchDeps) {
  // Ceiling for the model's `sources` override = exactly what the user enabled in
  // the UI. "Super" is explicit: it sends the full SUPER_SOURCES set, so that case
  // is already covered without special-casing. (Previously, selecting all 5 VISIBLE
  // toggles — ALL_SOURCES.length — was mis-read as Super and silently unlocked the
  // hidden namespaces the user never picked.)
  const allowedSources = new Set<SourceType>(defaultSources);

  return tool({
    description: `Run a general semantic search across the user's selected LDS sources. Tool input query must be in ${retrievalLanguageName}. Use this when the question is topical and does not target a specific scripture reference or a specific conference talk. Results may include bounded related context from the same selected sources; use it to refine the answer when relevant. Returns ranked chunks with citation indices.`,
    inputSchema,
    execute: async ({ query, topK, sources }) => {
      const startedAt = Date.now();
      const effectiveTopK = topK ?? defaultTopK;
      const requestedSources = sources && sources.length > 0 ? sources : defaultSources;
      const filteredSources = requestedSources.filter((source) => allowedSources.has(source));
      const effectiveSources = filteredSources.length > 0 ? filteredSources : defaultSources;

      onProgress?.({
        phase: "sources",
        toolName: "semantic_search",
      });

      const key = cacheKey(
        query,
        language,
        effectiveSources,
        effectiveTopK,
        retrievalFlagsSignature()
      );
      const cached = await getFromCache(key);
      const effectiveSourceSet = new Set(effectiveSources);
      let combined: SourceChunk[];
      if (cached) {
        combined = cached.chunks.filter((chunk) => effectiveSourceSet.has(chunk.source));
      } else {
        const primary = await retrieve(query, effectiveSources, language, effectiveTopK);
        // Attach a bounded slice of each top hit's cross-references / study-help
        // context (the graph projected into Pinecone metadata) for fuller answers.
        const relatedContext = await expandRelatedContext(primary, language, {
          fromTopN: RELATED_FROM_TOP_N,
          cap: RELATED_CONTEXT_CAP,
          sources: effectiveSources,
        });
        combined = [...primary, ...relatedContext];
        // Best-effort warm cache write; the chat route will overwrite later
        // with the assistant's final answer text.
        void setInCache(key, { chunks: combined, answer: "" });
      }

      // Graph-aware rerank (flag-gated): a chunk cross-referenced by several
      // others in the retrieved neighborhood is central to the topic, so promote
      // it (capped). Falls back to plain vector + expansion order when disabled.
      const chunks = isGraphRerankEnabled()
        ? graphRerank(combined, [], { rerankSeeds: true })
        : combined;

      const indexedChunks = context.registerChunks(chunks);
      onProgress?.({
        phase: "tools",
        toolName: "semantic_search",
        sourceCount: chunks.length,
        cacheHit: !!cached,
        elapsedMs: Date.now() - startedAt,
      });

      return {
        query,
        language,
        sources: effectiveSources,
        cacheHit: !!cached,
        total: chunks.length,
        chunks: indexedChunks.map(({ chunk, citationIndex }) =>
          toToolChunk(chunk, citationIndex)
        ),
      };
    },
  });
}
