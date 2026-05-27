import { tool } from "ai";
import { z } from "zod";
import { retrieve } from "@/lib/rag/retriever";
import {
  getToolResultFromCache,
  setToolResultInCache,
  toolResultCacheKey,
} from "@/lib/rag/cache";
import { parseScriptureSelection } from "@/lib/rag/scripture-reference";
import type { Language, SourceChunk } from "@/lib/types";
import { toToolChunk } from "../shared/chunk-formatting";
import { normalizeBookForStrictMatch } from "../shared/text-normalize";
import type { RagToolContext } from "../shared/tool-context";

const inputSchema = z.object({
  reference: z
    .string()
    .min(1)
    .describe("Scripture reference or request, e.g. '2 Nefi 2' or 'Moroni 10:4-5'"),
  topK: z.number().int().min(1).max(30).optional().default(16),
});

export interface LookupScripturePassageDeps {
  language: Language;
  context: RagToolContext;
  retrievalLanguageName?: string;
}

/**
 * `lookup_scripture_passage`: structured retrieval of a scripture passage by
 * reference. Applies strict book/chapter filtering on top of the semantic
 * search and falls back to the unfiltered list when the strict filter would
 * have returned nothing.
 */
export function createLookupScripturePassageTool({
  language,
  context,
  retrievalLanguageName = "the configured index language",
}: LookupScripturePassageDeps) {
  return tool({
    description: `Retrieve scripture passages (Book of Mormon, D&C, Pearl of Great Price) by reference or scripture-focused query. Tool input reference must be in ${retrievalLanguageName}.`,
    inputSchema,
    execute: async ({ reference, topK }) => {
      const key = toolResultCacheKey("lookup_scripture_passage", language, {
        reference,
        topK,
      });
      const cached = await getToolResultFromCache<SourceChunk[]>(key);
      const chunks = cached ?? (await retrieve(reference, ["scriptures"], language, topK));
      if (!cached) {
        await setToolResultInCache(key, chunks);
      }

      const selection = parseScriptureSelection(reference, language);

      const strictChunks: SourceChunk[] = selection
        ? chunks.filter((chunk) => {
            const sameBook =
              normalizeBookForStrictMatch(chunk.book ?? "") ===
              normalizeBookForStrictMatch(selection.canonicalBook);
            const sameChapter = selection.chapters.includes(chunk.chapter ?? -1);
            return sameBook && sameChapter;
          })
        : chunks;

      const finalChunks = (strictChunks.length > 0 ? strictChunks : chunks).slice(0, topK);
      const indexedChunks = context.registerChunks(finalChunks);

      return {
        reference,
        language,
        cacheHit: !!cached,
        total: finalChunks.length,
        chunks: indexedChunks.map(({ chunk, citationIndex }) =>
          toToolChunk(chunk, citationIndex)
        ),
      };
    },
  });
}
