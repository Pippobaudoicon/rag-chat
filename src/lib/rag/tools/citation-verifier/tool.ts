import { tool } from "ai";
import { z } from "zod";
import type { RagToolContext } from "../shared/tool-context";
import { extractCitationMarkers } from "./citation-markers";

const inputSchema = z.object({
  answerText: z
    .string()
    .min(1)
    .describe("Draft assistant answer containing inline numeric citations"),
});

export interface CitationVerifierDeps {
  context: RagToolContext;
}

/**
 * `citation_verifier`: confirms every `[N]` / `[Source N]` marker in a draft
 * answer points at a chunk that actually exists in this turn's source list,
 * and flags malformed markers (e.g. `[?]`, `[note: ...]`).
 *
 * The tool is read-only — it does not register chunks or mutate state. It
 * relies on `context.citationCount()` for the live upper bound which grows as
 * other tools register new chunks during the same turn.
 */
export function createCitationVerifierTool({ context }: CitationVerifierDeps) {
  return tool({
    description:
      "Validate inline numeric citations like [1], [2] against the current source list for this answer.",
    inputSchema,
    execute: async ({ answerText }) => {
      const { uniqueIndices: cited, malformedMarkers } = extractCitationMarkers(answerText);
      const maxIndex = context.citationCount();

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
        note: buildNote({ hasInvalid, hasMalformed, invalid, malformedMarkers, maxIndex }),
      };
    },
  });
}

function buildNote(args: {
  hasInvalid: boolean;
  hasMalformed: boolean;
  invalid: number[];
  malformedMarkers: string[];
  maxIndex: number;
}): string {
  const { hasInvalid, hasMalformed, invalid, malformedMarkers, maxIndex } = args;

  if (!hasInvalid && !hasMalformed) {
    return "All citation markers are valid and within the available source range.";
  }

  return [
    hasInvalid ? `Out-of-range markers: ${invalid.map((n) => `[${n}]`).join(", ")}.` : undefined,
    hasMalformed
      ? `Malformed markers: ${malformedMarkers.join(", ")}. Use [N] or [Source N].`
      : undefined,
    `Allowed citation range for this turn: [1]...[${maxIndex}].`,
  ]
    .filter(Boolean)
    .join(" ");
}
