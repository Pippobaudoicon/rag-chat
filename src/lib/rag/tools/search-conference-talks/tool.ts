import { tool } from "ai";
import { z } from "zod";
import { retrieve } from "@/lib/rag/retriever";
import type { Language, SourceChunk } from "@/lib/types";
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
  language: Language;
  context: RagToolContext;
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
  context,
}: SearchConferenceTalksDeps) {
  return tool({
    description:
      "Search General Conference talks by topic with optional speaker and year filters.",
    inputSchema,
    execute: async ({ query, title, speaker, year, topK }) => {
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

      const chunks = uniqueById(
        (
          await Promise.all(
            queryCandidates.map((candidate) =>
              retrieve(candidate, ["conference"], language, Math.max(topK * 3, 30))
            )
          )
        ).flat()
      );

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

      const returned = final.slice(0, topK);
      const indexedChunks = context.registerChunks(returned);

      return {
        query,
        queryCandidates,
        speaker: effectiveSpeaker,
        year: effectiveYear,
        language,
        strategy,
        requestedTitle,
        matchType,
        strictMatches: strict.length,
        total: returned.length,
        note: buildNote({
          requestedTitle,
          returnedCount: returned.length,
          exactTitleMatch,
          confirmedTitleMatch,
        }),
        chunks: indexedChunks.map(({ chunk, citationIndex }) =>
          toToolChunk(chunk, citationIndex)
        ),
      };
    },
  });
}

function buildNote(args: {
  requestedTitle: string | undefined;
  returnedCount: number;
  exactTitleMatch: boolean;
  confirmedTitleMatch: boolean;
}): string {
  const { requestedTitle, returnedCount, exactTitleMatch, confirmedTitleMatch } = args;

  if (returnedCount > 0) {
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
