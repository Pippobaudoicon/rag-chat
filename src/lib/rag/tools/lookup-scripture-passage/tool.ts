import { tool } from "ai";
import { z } from "zod";
import { retrieve } from "@/lib/rag/retriever";
import {
  getToolResultFromCache,
  setToolResultInCache,
  toolResultCacheKey,
} from "@/lib/rag/cache";
import { parseScriptureSelection } from "@/lib/rag/scripture-reference";
import type { ChatProgressData, SourceChunk } from "@/lib/types";
import { toToolChunk } from "../shared/chunk-formatting";
import { expandRelatedContext, filterRelatedToLanguage } from "../shared/related-context";
import { graphRerank } from "../shared/graph-rerank";
import { isGraphRerankEnabled } from "@/lib/rag/flags";
import type { RagToolContext } from "../shared/tool-context";

const inputSchema = z.object({
  reference: z
    .string()
    .min(1)
    .describe("Scripture reference or request, e.g. '2 Nefi 2' or 'Moroni 10:4-5'"),
  language: z
    .enum(["eng", "ita"])
    .describe("Indexed scripture language matching the user's original question: eng or ita"),
  topK: z.number().int().min(1).max(30).optional().default(16),
});

// How many cross-referenced/study-help chunks to attach as supporting context.
// A passage lookup is intentionally generous: the whole point is the scriptural
// web around the requested verses, so we expand from every passage chunk.
const RELATED_CONTEXT_CAP = 24;

/**
 * Cached shape for a passage lookup: the neutral, pre-rerank split. Storing the
 * passage and its related context separately lets the (flag-dependent) graph
 * rerank run after the cache read — the requested passage stays pinned while the
 * supporting context is reordered. Bump the `v` param in the cache key if this
 * shape changes.
 */
interface CachedPassage {
  passage: SourceChunk[];
  related: SourceChunk[];
}

export interface LookupScripturePassageDeps {
  context: RagToolContext;
  onProgress?: (progress: ChatProgressData) => void;
}

/**
 * `lookup_scripture_passage`: structured retrieval of a scripture passage by
 * reference. Applies strict book/chapter filtering on top of the semantic
 * search and falls back to the unfiltered list when the strict filter would
 * have returned nothing. The reference is NOT translated — book names are
 * resolved through language-invariant aliases/slugs — and chunks are returned in
 * the selected scripture language. It never falls back to the other language.
 */
export function createLookupScripturePassageTool({
  context,
  onProgress,
}: LookupScripturePassageDeps) {
  return tool({
    description: `Retrieve scripture passages (Book of Mormon, D&C, Pearl of Great Price) by reference or scripture-focused query. Pass the reference in the user's own language (e.g. "Giovanni 3:16" or "John 3:16") and select the matching indexed language ("ita" or "eng"). Book names are matched language-invariantly, so do not translate the reference. Results may include related cross-reference and study-help chunks.`,
    inputSchema,
    execute: async ({ reference, language, topK }) => {
      const startedAt = Date.now();
      language = context.resolveScriptureLanguage(language);
      onProgress?.({
        phase: "sources",
        toolName: "lookup_scripture_passage",
      });

      // Cache the NEUTRAL candidate set (passage + related, pre-rerank) split so
      // that the flag-dependent graph rerank can be applied after the cache read.
      // This keeps cache hits correct when RAG_GRAPH_RERANK is flipped. `v` is a
      // cache-shape version: bump it whenever the cached structure changes so old
      // (differently-shaped) entries are ignored rather than mis-parsed.
      // Cache by original normalized reference + preferred scripture language, so
      // an Italian and an English request for the same passage stay separate.
      const key = toolResultCacheKey("lookup_scripture_passage", language, {
        reference,
        topK,
        v: 5,
      });
      const cached = await getToolResultFromCache<CachedPassage>(key);

      let passage: SourceChunk[];
      let relatedContext: SourceChunk[];
      if (cached) {
        ({ passage, related: relatedContext } = cached);
      } else {
        const chunks = await retrieve(reference, ["scriptures"], language, topK, {
          scriptureLanguage: language,
        });
        const selection = parseScriptureSelection(reference, language);

        const strictChunks: SourceChunk[] = selection
          ? chunks.filter((chunk) => {
              // Match the language-invariant book slug (chunk id 3rd segment:
              // `scriptures:<lang>:<bookSlug>:…`). The `book` metadata is the
              // display name in the chunk's language ("Giovanni" vs "John") and
              // selection.canonicalBook is Italian, so a name comparison fails
              // across languages — the slug is authoritative.
              const sameBook = chunk.id.split(":")[2] === selection.bookSlug;
              const sameChapter = selection.chapters.includes(chunk.chapter ?? -1);
              return sameBook && sameChapter;
            })
          : chunks;

        passage = (strictChunks.length > 0 ? strictChunks : chunks).slice(0, topK);
        // Attach the passage's cross-references + study-help context (graph) in
        // the passage's ACTUAL language (the model-selected language, or the
        // fallback language when the passage was only available there). The graph
        // stores English edges, so expandRelatedContext localizes scripture refs
        // to this language; the filter then drops anything still cross-language
        // (e.g. English-only study helps) — single-language direct-passage contract.
        const passageLanguage = passage[0]?.language ?? language;
        relatedContext = filterRelatedToLanguage(
          await expandRelatedContext(passage, passageLanguage, { cap: RELATED_CONTEXT_CAP }),
          passageLanguage
        );
        void setToolResultInCache(key, { passage, related: relatedContext });
      }

      // Graph-aware rerank of the supporting context (flag-gated), applied AFTER
      // the cache read so flipping RAG_GRAPH_RERANK takes effect immediately:
      // cross-references shared by several passage verses float to the top, while
      // the requested passage itself stays pinned in verse order.
      const finalChunks = isGraphRerankEnabled()
        ? graphRerank(passage, relatedContext, { rerankSeeds: false })
        : [...passage, ...relatedContext];

      const indexedChunks = context.registerChunks(finalChunks);
      onProgress?.({
        phase: "tools",
        toolName: "lookup_scripture_passage",
        sourceCount: indexedChunks.length,
        cacheHit: !!cached,
        elapsedMs: Date.now() - startedAt,
      });

      return {
        reference,
        language,
        cacheHit: !!cached,
        total: indexedChunks.length,
        chunks: indexedChunks.map(({ chunk, citationIndex }) =>
          toToolChunk(chunk, citationIndex)
        ),
      };
    },
  });
}
