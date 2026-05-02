import { tool } from "ai";
import { z } from "zod";
import { retrieve } from "@/lib/rag/retriever";
import { cacheKey, getFromCache, setInCache } from "@/lib/rag/cache";
import { ALL_SOURCES, SUPER_SOURCES } from "@/lib/types";
import type { Language, SourceType } from "@/lib/types";
import { toToolChunk } from "../shared/chunk-formatting";
import type { RagToolContext } from "../shared/tool-context";

const SOURCE_VALUES: SourceType[] = SUPER_SOURCES;

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
}: SemanticSearchDeps) {
  // Restrict the LLM to sources the user has actually enabled in the UI
  // (or any source if the user opted into "Super").
  const allowedSources = new Set<SourceType>(
    defaultSources.length === ALL_SOURCES.length || defaultSources.length === SUPER_SOURCES.length
      ? SUPER_SOURCES
      : defaultSources
  );

  return tool({
    description:
      "Run a general semantic search across the user's selected LDS sources. Use this when the question is topical and does not target a specific scripture reference or a specific conference talk. Returns ranked chunks with citation indices.",
    inputSchema,
    execute: async ({ query, topK, sources }) => {
      const effectiveTopK = topK ?? defaultTopK;
      const requestedSources = sources && sources.length > 0 ? sources : defaultSources;
      const filteredSources = requestedSources.filter((source) => allowedSources.has(source));
      const effectiveSources = filteredSources.length > 0 ? filteredSources : defaultSources;

      const key = cacheKey(query, language, effectiveSources, effectiveTopK);
      const cached = await getFromCache(key);
      const chunks = cached?.chunks ?? (await retrieve(query, effectiveSources, language, effectiveTopK));
      if (!cached) {
        // Best-effort warm cache write; the chat route will overwrite later
        // with the assistant's final answer text.
        await setInCache(key, { chunks, answer: "" });
      }

      const indexedChunks = context.registerChunks(chunks);

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
