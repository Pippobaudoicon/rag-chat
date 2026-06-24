import { tool } from "ai";
import { z } from "zod";
import {
  retrieveConferenceCandidates,
  fetchConferenceTalkChunks,
  conferenceTalkKey,
} from "@/lib/rag/retriever";
import {
  getToolResultFromCache,
  setToolResultInCache,
  toolResultCacheKey,
} from "@/lib/rag/cache";
import type { ChatProgressData, Language, SourceChunk } from "@/lib/types";
import {
  aggregateRoutingTelemetry,
  type RetrievalQueryResolver,
} from "@/lib/rag/retrieval-query-resolver";
import type { QueryLanguageRouting } from "@/lib/rag/language-routing";
import { toToolChunk, uniqueById, uniqueStrings } from "../shared/chunk-formatting";
import { normalizeForMatch } from "../shared/text-normalize";
import type { RagToolContext } from "../shared/tool-context";
import {
  inferSpeakerFromQuery,
  inferTitleFromQuery,
  inferYearFromQuery,
} from "./query-inference";
import {
  buildSpeakerMatcher,
  buildYearMatcher,
  hasConfirmedTitleEvidence,
  hasExactTitleEvidence,
  titleMatchesRequested,
} from "./matching";

const inputSchema = z.object({
  query: z.string().min(1).describe("The thematic query to search conference talks for"),
  title: z.string().optional().describe("Optional exact or near-exact talk title"),
  speaker: z
    .string()
    .optional()
    .describe("Optional speaker filter, e.g. 'Russell M. Nelson'"),
  year: z.number().int().min(1900).max(2100).optional().describe("Optional year filter"),
  topK: z.number().int().min(1).max(30).optional().default(12),
});

export interface SearchConferenceTalksDeps {
  /** Semantic corpus language to retrieve against (English by default). */
  language: Language;
  /** Lazy translation resolver: the free-text query and optional title are
   *  resolved to `language` inside execute() (speaker/year are preserved). */
  resolver: RetrievalQueryResolver;
  context: RagToolContext;
  onProgress?: (progress: ChatProgressData) => void;
}

type Strategy = "strict" | "relaxed" | "title-not-found" | "semantic-only";
type MatchType = "exact-title" | "confirmed-title" | "not-found" | "semantic";

/**
 * `search_conference_talks`: structured + semantic retrieval over the
 * `conference` namespace with optional speaker, year, and title constraints.
 *
 * Decision flow:
 *   1. Infer missing speaker/year/title from the free-text query.
 *   2. Run the retrieval over multiple query candidates (raw query + title
 *      variants enriched with speaker/year) and merge.
 *   3. Apply strict filters; relax progressively when nothing matches; never
 *      fall back to unrelated same-speaker talks when a title was requested.
 *   4. Annotate the returned payload with `strategy`, `matchType`, and a
 *      human-readable `note` so the model can communicate uncertainty.
 */
export function createSearchConferenceTalksTool({
  language,
  resolver,
  context,
  onProgress,
}: SearchConferenceTalksDeps) {
  return tool({
    description: `Search General Conference talks by topic with optional speaker and year filters. Pass the query and title in the user's own language — searchable text is translated to the retrieval corpus language internally, while speaker names and years are preserved. Returns ranked chunks with citation indices.`,
    inputSchema,
    execute: async ({ query, title, speaker, year, topK }) => {
      const startedAt = Date.now();
      onProgress?.({
        phase: "sources",
        toolName: "search_conference_talks",
      });

      // Resolve the searchable free text (query + optional title) to the corpus
      // language before inference/matching; speaker and year are structured
      // constraints and pass through untranslated. English input is identity
      // (no LLM call); a cross-language query translates once (memoized). BOTH
      // resolutions are recorded in telemetry (summed/OR'd) below.
      const routings: QueryLanguageRouting[] = [];
      const queryRouting = await resolver.resolve(query, language);
      routings.push(queryRouting);
      query = queryRouting.searchQuery;
      if (title) {
        const titleRouting = await resolver.resolve(title, language);
        routings.push(titleRouting);
        title = titleRouting.searchQuery;
      }

      const inferredSpeaker = inferSpeakerFromQuery(query);
      const effectiveSpeaker = speaker ?? inferredSpeaker;
      const normalizedSpeaker = effectiveSpeaker
        ? normalizeForMatch(effectiveSpeaker)
        : undefined;

      const inferredYear = inferYearFromQuery(query);
      const effectiveYear = year ?? inferredYear;
      const yearString = effectiveYear ? String(effectiveYear) : undefined;

      const requestedTitle = title ?? inferTitleFromQuery(query);

      const queryCandidates = uniqueStrings([
        query,
        ...(requestedTitle
          ? [
              requestedTitle,
              effectiveSpeaker ? `${requestedTitle} ${effectiveSpeaker}` : "",
              effectiveYear ? `${requestedTitle} ${effectiveYear}` : "",
            ]
          : []),
      ]);

      const retrievalTopK = Math.max(topK * 3, 30);
      const key = toolResultCacheKey("search_conference_talks", language, {
        query,
        title: requestedTitle,
        speaker: effectiveSpeaker,
        year: effectiveYear,
        topK,
        queryCandidates,
        retrievalTopK,
      });
      const cached = await getToolResultFromCache<SourceChunk[]>(key);
      const chunks =
        cached ??
        uniqueById(
          await retrieveConferenceCandidates(
            queryCandidates,
            language,
            retrievalTopK
          )
        );

      if (!cached) {
        void setToolResultInCache(key, chunks);
      }

      const speakerMatches = buildSpeakerMatcher(normalizedSpeaker);
      const yearMatches = buildYearMatcher(yearString);
      const titleMatches = (chunk: SourceChunk) =>
        titleMatchesRequested(chunk.title, requestedTitle);

      const strict = chunks.filter(
        (chunk) => speakerMatches(chunk) && yearMatches(chunk) && titleMatches(chunk)
      );

      // If a title was requested, never fall back to unrelated same-speaker
      // talks. For topical searches without a title, relax speaker/year
      // filters gracefully.
      const titleOnly = requestedTitle ? chunks.filter(titleMatches) : [];
      const relaxed =
        strict.length > 0
          ? strict
          : requestedTitle
            ? titleOnly.filter((chunk) => speakerMatches(chunk) && yearMatches(chunk))
            : uniqueById([
                ...(normalizedSpeaker ? chunks.filter(speakerMatches) : []),
                ...(yearString ? chunks.filter(yearMatches) : []),
              ]);

      const final =
        strict.length > 0
          ? strict
          : relaxed.length > 0
            ? relaxed
            : requestedTitle
              ? []
              : chunks;

      const exactTitleMatch =
        !!requestedTitle && final.some((chunk) => hasExactTitleEvidence(chunk.title, requestedTitle));
      const confirmedTitleMatch =
        !!requestedTitle &&
        final.some((chunk) => hasConfirmedTitleEvidence(chunk.title, requestedTitle));

      const strategy: Strategy =
        strict.length > 0
          ? "strict"
          : relaxed.length > 0
            ? "relaxed"
            : requestedTitle
              ? "title-not-found"
              : "semantic-only";

      const matchType: MatchType = exactTitleMatch
        ? "exact-title"
        : confirmedTitleMatch
          ? "confirmed-title"
          : requestedTitle
            ? "not-found"
            : "semantic";

      // Deterministic completion: when a requested title is confirmed among the
      // semantic results, replace the partial slice with the COMPLETE talk,
      // fetched by its id prefix (`conference:lang:year:session:slug`) in reading
      // order — so the model sees the whole talk, not whichever chunks semantic
      // search happened to surface. Falls through to the semantic slice if the
      // talk could not be identified or fetched.
      const titleMatchedChunks =
        exactTitleMatch || confirmedTitleMatch
          ? (strict.length > 0 ? strict : final).filter(titleMatches)
          : [];
      const talkKey = pickDominantTalkKey(titleMatchedChunks);
      // Fail open: completion is a best-effort upgrade over the semantic slice.
      // If listing/fetching the full talk errors (transient failure, or a
      // non-serverless index where listPaginated is unsupported), keep the
      // already-valid semantic results rather than failing the whole tool.
      let fullTalk: SourceChunk[] = [];
      if (talkKey) {
        try {
          fullTalk = await fetchConferenceTalkChunks(talkKey, language);
        } catch (error) {
          console.error(
            "Conference talk completion failed; using semantic results",
            error
          );
        }
      }
      const completedTalk = fullTalk.length > 0;

      const returned = completedTalk ? fullTalk : final.slice(0, topK);
      const indexedChunks = context.registerChunks(returned);
      onProgress?.({
        phase: "tools",
        toolName: "search_conference_talks",
        sourceCount: returned.length,
        cacheHit: !!cached,
        elapsedMs: Date.now() - startedAt,
        retrievalLanguage: language,
        ...aggregateRoutingTelemetry(routings),
      });

      return {
        query,
        queryCandidates,
        speaker: effectiveSpeaker,
        year: effectiveYear,
        language,
        cacheHit: !!cached,
        strategy,
        requestedTitle,
        matchType,
        strictMatches: strict.length,
        total: returned.length,
        completedTalk,
        note: buildNote({
          requestedTitle,
          returnedCount: returned.length,
          exactTitleMatch,
          confirmedTitleMatch,
          completedTalk,
        }),
        chunks: indexedChunks.map(({ chunk, citationIndex }) =>
          toToolChunk(chunk, citationIndex)
        ),
      };
    },
  });
}

// Among title-matched chunks, choose the talk (by id prefix) with the most
// matching chunks — the dominant talk the user almost certainly meant. Returns
// undefined when there are no candidates.
function pickDominantTalkKey(chunks: SourceChunk[]): string | undefined {
  const counts = new Map<string, number>();
  for (const chunk of chunks) {
    const key = conferenceTalkKey(chunk.id);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function buildNote(args: {
  requestedTitle: string | undefined;
  returnedCount: number;
  exactTitleMatch: boolean;
  confirmedTitleMatch: boolean;
  completedTalk: boolean;
}): string {
  const { requestedTitle, returnedCount, exactTitleMatch, confirmedTitleMatch, completedTalk } = args;

  if (returnedCount > 0) {
    if (completedTalk)
      return "Returned the complete talk, fetched deterministically by id — these are all of that talk's chunks in reading order.";
    if (exactTitleMatch) return "Results include at least one exact title match.";
    if (confirmedTitleMatch)
      return "Results include chunks whose metadata title matches the requested title.";
    return "Results found based on semantic conference retrieval.";
  }

  if (requestedTitle) {
    return "No conference talk matching the requested title was found in the conference namespace. Do not answer as if the exact requested talk was retrieved.";
  }
  return "No conference matches found in current retrieval results.";
}
