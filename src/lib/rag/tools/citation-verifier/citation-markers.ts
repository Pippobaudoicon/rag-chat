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

const CITATION_INDEX_RE = /\[(?:source\s+)?(\d+)\]/gi;

export function extractCitationMarkers(answerText: string): CitationMarkers {
  const allMarkers = Array.from(answerText.matchAll(/\[[^\]]+\]/g), (m) => m[0]);
  const validMatches = Array.from(
    answerText.matchAll(CITATION_INDEX_RE),
    (m) => Number(m[1])
  ).filter((n) => Number.isInteger(n) && n > 0);

  const uniqueIndices = [...new Set(validMatches)].sort((a, b) => a - b);
  const malformedMarkers = allMarkers.filter(
    (marker) => !/\[(?:source\s+)?\d+\]/i.test(marker)
  );

  return { uniqueIndices, malformedMarkers };
}

/** A draft-answer sentence that carries one or more inline citations. */
export interface CitedClaim {
  sentence: string;
  indices: number[];
}

/**
 * Split a draft answer into sentences and keep those that carry inline numeric
 * citations, with the cited indices. Used by the claim-support audit to check
 * each cited claim against the sources it actually cites. Sentence splitting is
 * deliberately simple (newlines + sentence punctuation) — good enough to pair a
 * claim with its citations.
 */
export function extractCitedClaims(answerText: string): CitedClaim[] {
  const sentences = answerText
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);

  const claims: CitedClaim[] = [];
  for (const sentence of sentences) {
    const indices = [
      ...new Set(
        Array.from(sentence.matchAll(CITATION_INDEX_RE), (m) => Number(m[1])).filter(
          (n) => Number.isInteger(n) && n > 0
        )
      ),
    ];
    if (indices.length > 0) claims.push({ sentence, indices });
  }
  return claims;
}
