/**
 * Parses inline citation markers out of an assistant draft answer.
 *
 * Recognized formats: `[1]`, `[12]`, `[Source 1]` (case-insensitive).
 * Anything else inside square brackets (e.g. `[?]`, `[Source A]`,
 * `[note: ...]`) is reported as malformed.
 */
export interface CitationMarkers {
  uniqueIndices: number[];
  malformedMarkers: string[];
}

export function extractCitationMarkers(answerText: string): CitationMarkers {
  const allMarkers = Array.from(answerText.matchAll(/\[[^\]]+\]/g), (m) => m[0]);
  const validMatches = Array.from(
    answerText.matchAll(/\[(?:source\s+)?(\d+)\]/gi),
    (m) => Number(m[1])
  ).filter((n) => Number.isInteger(n) && n > 0);

  const uniqueIndices = [...new Set(validMatches)].sort((a, b) => a - b);
  const malformedMarkers = allMarkers.filter(
    (marker) => !/\[(?:source\s+)?\d+\]/i.test(marker)
  );

  return { uniqueIndices, malformedMarkers };
}
