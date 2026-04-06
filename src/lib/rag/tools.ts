import { tool } from "ai";
import { z } from "zod";
import { retrieve } from "@/lib/rag/retriever";
import type { Language, SourceChunk } from "@/lib/types";

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function toToolChunk(chunk: SourceChunk) {
  return {
    id: chunk.id,
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

function extractCitationIndices(answerText: string): number[] {
  const matches = answerText.matchAll(/\[(\d+)\]/g);
  const numbers = Array.from(matches, (m) => Number(m[1])).filter(
    (n) => Number.isInteger(n) && n > 0
  );
  return [...new Set(numbers)].sort((a, b) => a - b);
}

export function createRagTools(language: Language, contextChunks: SourceChunk[]) {
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
        return {
          reference,
          language,
          total: chunks.length,
          chunks: chunks.map(toToolChunk),
        };
      },
    }),

    search_conference_talks: tool({
      description:
        "Search General Conference talks by topic with optional speaker and year filters.",
      inputSchema: z.object({
        query: z.string().min(1).describe("The thematic query to search conference talks for"),
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
      execute: async ({ query, speaker, year, topK }) => {
        const chunks = await retrieve(query, ["conference"], language, Math.max(topK * 3, 30));

        const normalizedSpeaker = speaker ? normalizeForMatch(speaker) : undefined;
        const yearString = year ? String(year) : undefined;

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

        const strict = chunks.filter((chunk) => speakerMatches(chunk) && yearMatches(chunk));

        // If strict filters produce no results, relax gracefully instead of returning empty.
        // This avoids false negatives when metadata is incomplete/noisy.
        const relaxed =
          strict.length > 0
            ? strict
            : uniqueById([
                ...(normalizedSpeaker ? chunks.filter(speakerMatches) : []),
                ...(yearString ? chunks.filter(yearMatches) : []),
              ]);

        const final = strict.length > 0 ? strict : relaxed.length > 0 ? relaxed : chunks;
        const strategy =
          strict.length > 0 ? "strict" : relaxed.length > 0 ? "relaxed" : "semantic-only";

        return {
          query,
          speaker,
          year,
          language,
          strategy,
          strictMatches: strict.length,
          total: final.length,
          note:
            final.length > 0
              ? "Results found. Do not state that the talk was not found."
              : "No conference matches found in current retrieval results.",
          chunks: final.slice(0, topK).map(toToolChunk),
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
        const cited = extractCitationIndices(answerText);
        const maxIndex = contextChunks.length;

        const invalid = cited.filter((n) => n > maxIndex);
        const valid = cited.filter((n) => n <= maxIndex);
        const uncitedSourceCount = Math.max(0, maxIndex - valid.length);

        return {
          isValid: invalid.length === 0,
          totalContextSources: maxIndex,
          citedIndices: cited,
          validIndices: valid,
          invalidIndices: invalid,
          uncitedSourceCount,
          note:
            invalid.length === 0
              ? "All citation markers are within the available source range."
              : `Invalid markers found: ${invalid.join(", ")}. Use only [1]...[${maxIndex}] for this turn.`,
        };
      },
    }),
  };
}
