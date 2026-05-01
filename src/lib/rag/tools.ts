import { tool } from "ai";
import { z } from "zod";
import { retrieve } from "@/lib/rag/retriever";
import { parseScriptureSelection } from "@/lib/rag/scripture-reference";
import type { Language, SourceChunk } from "@/lib/types";

type ToolSourceListener = (chunks: SourceChunk[]) => void;
type IndexedToolChunk = { chunk: SourceChunk; citationIndex: number };

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBookForStrictMatch(value: string): string {
  return normalizeForMatch(value).replace(/\s+/g, " ").trim();
}

function inferYearFromQuery(query: string): number | undefined {
  const match = query.match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return undefined;
  const year = Number(match[1]);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return undefined;
  return year;
}

function inferSpeakerFromQuery(query: string): string | undefined {
  // Supports patterns like "... di Uchtdorf" / "... by Dieter F. Uchtdorf".
  const m = query.match(/\b(?:di|by)\s+([\p{L}][\p{L}\s.'-]{1,80})$/iu);
  const candidate = m?.[1]?.trim();
  if (!candidate) return undefined;
  return candidate;
}

function inferTitleFromQuery(query: string): string | undefined {
  const quoted = query.match(/["“”'‘’]([^"“”'‘’]{4,120})["“”'‘’]/u);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  const beforeBy = query.match(/^(.+?)\b(?:di|by)\b\s+[\p{L}][\p{L}\s.'-]{1,80}$/iu);
  if (!beforeBy?.[1]) return undefined;

  let candidate = beforeBy[1]
    .replace(/\b(approfondiamo|approfondisci|approfondire|cerca|search|talk|discorso)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = candidate.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 12) return undefined;

  return candidate;
}

function titleMatchesRequested(chunkTitle: string | undefined, requestedTitle: string | undefined): boolean {
  if (!requestedTitle) return true;
  const title = normalizeForMatch(chunkTitle ?? "");
  const requested = normalizeForMatch(requestedTitle);
  if (!title || !requested) return false;
  return title.includes(requested) || requested.includes(title);
}

function hasExactTitleEvidence(chunkTitle: string | undefined, requestedTitle: string | undefined): boolean {
  if (!requestedTitle) return false;
  const title = normalizeForMatch(chunkTitle ?? "");
  const requested = normalizeForMatch(requestedTitle);
  if (!title || !requested) return false;
  return title === requested;
}

function hasConfirmedTitleEvidence(
  chunkTitle: string | undefined,
  requestedTitle: string | undefined
): boolean {
  if (!requestedTitle) return false;
  const title = normalizeForMatch(chunkTitle ?? "");
  const requested = normalizeForMatch(requestedTitle);
  if (!title || !requested) return false;
  return title === requested || title.startsWith(requested);
}

function uniqueById(chunks: SourceChunk[]): SourceChunk[] {
  const seen = new Set<string>();
  const out: SourceChunk[] = [];
  for (const chunk of chunks) {
    if (seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    out.push(chunk);
  }
  return out;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toToolChunk(chunk: SourceChunk, citationIndex?: number) {
  return {
    id: chunk.id,
    citationIndex,
    source: chunk.source,
    score: chunk.score,
    title: chunk.title,
    speaker: chunk.speaker,
    book: chunk.book,
    chapter: chunk.chapter,
    verse: chunk.verse,
    date: chunk.date,
    section: chunk.section,
    url: chunk.url,
    text: chunk.text.length > 1200 ? `${chunk.text.slice(0, 1200)}...` : chunk.text,
  };
}

function extractCitationMarkers(answerText: string): {
  uniqueIndices: number[];
  malformedMarkers: string[];
} {
  const allMarkers = Array.from(answerText.matchAll(/\[[^\]]+\]/g), (m) => m[0]);
  const validMatches = Array.from(answerText.matchAll(/\[(?:source\s+)?(\d+)\]/gi), (m) =>
    Number(m[1])
  ).filter((n) => Number.isInteger(n) && n > 0);

  const uniqueIndices = [...new Set(validMatches)].sort((a, b) => a - b);
  const malformedMarkers = allMarkers.filter((marker) => !/\[(?:source\s+)?\d+\]/i.test(marker));

  return {
    uniqueIndices,
    malformedMarkers,
  };
}

export function createRagTools(
  language: Language,
  contextChunks: SourceChunk[],
  onToolSources?: ToolSourceListener
) {
  let liveChunks = uniqueById(contextChunks);

  const registerToolChunks = (chunks: SourceChunk[]): IndexedToolChunk[] => {
    const nextLiveChunks = [...liveChunks];
    const indexed = chunks.map((chunk) => {
      const existingIndex = nextLiveChunks.findIndex((existing) => existing.id === chunk.id);
      if (existingIndex >= 0) {
        return { chunk, citationIndex: existingIndex + 1 };
      }

      nextLiveChunks.push(chunk);
      return {
        chunk,
        citationIndex: nextLiveChunks.length,
      };
    });

    liveChunks = nextLiveChunks;
    onToolSources?.(chunks);
    return indexed;
  };

  return {
    lookup_scripture_passage: tool({
      description:
        "Retrieve scripture passages (Book of Mormon, D&C, Pearl of Great Price) by reference or scripture-focused query.",
      inputSchema: z.object({
        reference: z
          .string()
          .min(1)
          .describe("Scripture reference or request, e.g. '2 Nefi 2' or 'Moroni 10:4-5'"),
        topK: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .default(16),
      }),
      execute: async ({ reference, topK }) => {
        const chunks = await retrieve(reference, ["scriptures"], language, topK);
        const selection = parseScriptureSelection(reference, language);

        const strictChunks = selection
          ? chunks.filter((chunk) => {
              const sameBook =
                normalizeBookForStrictMatch(chunk.book ?? "") ===
                normalizeBookForStrictMatch(selection.canonicalBook);
              const sameChapter = selection.chapters.includes(chunk.chapter ?? -1);
              return sameBook && sameChapter;
            })
          : chunks;

        const finalChunks = (strictChunks.length > 0 ? strictChunks : chunks).slice(0, topK);

        const indexedChunks = registerToolChunks(finalChunks);
        return {
          reference,
          language,
          total: finalChunks.length,
          chunks: indexedChunks.map(({ chunk, citationIndex }) =>
            toToolChunk(chunk, citationIndex)
          ),
        };
      },
    }),

    search_conference_talks: tool({
      description:
        "Search General Conference talks by topic with optional speaker and year filters.",
      inputSchema: z.object({
        query: z.string().min(1).describe("The thematic query to search conference talks for"),
        title: z
          .string()
          .optional()
          .describe("Optional exact or near-exact talk title"),
        speaker: z
          .string()
          .optional()
          .describe("Optional speaker filter, e.g. 'Russell M. Nelson'"),
        year: z
          .number()
          .int()
          .min(1900)
          .max(2100)
          .optional()
          .describe("Optional year filter"),
        topK: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .default(12),
      }),
      execute: async ({ query, title, speaker, year, topK }) => {
        const inferredSpeaker = inferSpeakerFromQuery(query);
        const effectiveSpeaker = speaker ?? inferredSpeaker;
        const normalizedSpeaker = effectiveSpeaker ? normalizeForMatch(effectiveSpeaker) : undefined;

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

        const speakerMatches = (chunk: SourceChunk) => {
          if (!normalizedSpeaker) return true;
          const speakerText = normalizeForMatch(chunk.speaker ?? "");
          if (!speakerText) return false;

          // Accept both strict includes and token overlap (helps with titles like
          // "Presidente Russell M. Nelson" vs "Russell Nelson").
          if (speakerText.includes(normalizedSpeaker) || normalizedSpeaker.includes(speakerText)) {
            return true;
          }

          const wantedTokens = normalizedSpeaker.split(" ").filter((t) => t.length > 1);
          const gotTokens = new Set(speakerText.split(" ").filter((t) => t.length > 1));
          const overlap = wantedTokens.filter((t) => gotTokens.has(t)).length;
          return overlap >= Math.min(2, wantedTokens.length);
        };

        const yearMatches = (chunk: SourceChunk) => {
          if (!yearString) return true;
          const dateText = chunk.date ?? "";
          const titleText = chunk.title ?? "";
          return dateText.includes(yearString) || titleText.includes(yearString);
        };

        const titleMatches = (chunk: SourceChunk) =>
          titleMatchesRequested(chunk.title, requestedTitle);

        const strict = chunks.filter(
          (chunk) => speakerMatches(chunk) && yearMatches(chunk) && titleMatches(chunk)
        );

        // If a title was requested, never fall back to unrelated same-speaker talks.
        // For topical searches without a title, relax speaker/year filters gracefully.
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

        const strategy =
          strict.length > 0
            ? "strict"
            : relaxed.length > 0
              ? "relaxed"
              : requestedTitle
                ? "title-not-found"
                : "semantic-only";
        const returned = final.slice(0, topK);
        const indexedChunks = registerToolChunks(returned);

        return {
          query,
          queryCandidates,
          speaker: effectiveSpeaker,
          year: effectiveYear,
          language,
          strategy,
          requestedTitle,
          matchType: exactTitleMatch
            ? "exact-title"
            : confirmedTitleMatch
              ? "confirmed-title"
              : requestedTitle
                ? "not-found"
                : "semantic",
          strictMatches: strict.length,
          total: returned.length,
          note:
            returned.length > 0
              ? exactTitleMatch
                ? "Results include at least one exact title match."
                : confirmedTitleMatch
                  ? "Results include chunks whose metadata title matches the requested title."
                  : "Results found based on semantic conference retrieval."
              : requestedTitle
                ? "No conference talk matching the requested title was found in the conference namespace. Do not answer as if the exact requested talk was retrieved."
                : "No conference matches found in current retrieval results.",
          chunks: indexedChunks.map(({ chunk, citationIndex }) =>
            toToolChunk(chunk, citationIndex)
          ),
        };
      },
    }),

    citation_verifier: tool({
      description:
        "Validate inline numeric citations like [1], [2] against the current source list for this answer.",
      inputSchema: z.object({
        answerText: z
          .string()
          .min(1)
          .describe("Draft assistant answer containing inline numeric citations"),
      }),
      execute: async ({ answerText }) => {
        const { uniqueIndices: cited, malformedMarkers } = extractCitationMarkers(answerText);
        const maxIndex = liveChunks.length;

        const invalid = cited.filter((n) => n > maxIndex);
        const valid = cited.filter((n) => n <= maxIndex);
        const uncitedSourceCount = Math.max(0, maxIndex - valid.length);
        const hasMalformed = malformedMarkers.length > 0;
        const hasInvalid = invalid.length > 0;

        return {
          isValid: !hasInvalid && !hasMalformed,
          totalContextSources: maxIndex,
          citedIndices: cited,
          validIndices: valid,
          invalidIndices: invalid,
          malformedMarkers,
          uncitedSourceCount,
          note:
            !hasInvalid && !hasMalformed
              ? "All citation markers are valid and within the available source range."
              : [
                  hasInvalid
                    ? `Out-of-range markers: ${invalid.map((n) => `[${n}]`).join(", ")}.`
                    : undefined,
                  hasMalformed
                    ? `Malformed markers: ${malformedMarkers.join(", ")}. Use [N] or [Source N].`
                    : undefined,
                  `Allowed citation range for this turn: [1]...[${maxIndex}].`,
                ]
                  .filter(Boolean)
                  .join(" "),
        };
      },
    }),
  };
}
