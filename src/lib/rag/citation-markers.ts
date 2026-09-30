/**
 * Unique inline citation indices in an answer, sorted ascending.
 * Recognized formats: `[1]`, `[12]`, `[Source 1]` (case-insensitive).
 */
export function extractCitationMarkers(answerText: string): number[] {
  const indices = Array.from(
    answerText.matchAll(/\[(?:source\s+)?(\d+)\]/gi),
    (m) => Number(m[1])
  ).filter((n) => n > 0);
  return [...new Set(indices)].sort((a, b) => a - b);
}
