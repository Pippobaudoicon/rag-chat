/**
 * Heuristics that mine optional structured filters out of a free-form
 * conference-talk query. These run as a fallback when the model did not pass
 * `speaker`, `year`, or `title` arguments explicitly.
 */

export function inferYearFromQuery(query: string): number | undefined {
  const match = query.match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return undefined;
  const year = Number(match[1]);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return undefined;
  return year;
}

/** Supports patterns like "... di Uchtdorf" / "... by Dieter F. Uchtdorf". */
export function inferSpeakerFromQuery(query: string): string | undefined {
  const m = query.match(/\b(?:di|by)\s+([\p{L}][\p{L}\s.'-]{1,80})$/iu);
  const candidate = m?.[1]?.trim();
  if (!candidate) return undefined;
  return candidate;
}

/**
 * Tries to extract a likely talk title from the user's query. Quoted strings
 * win; otherwise we look at the words preceding a "by/di <speaker>" tail and
 * strip common verbs ("cerca", "search", "approfondisci", ...).
 */
export function inferTitleFromQuery(query: string): string | undefined {
  const quoted = query.match(/["“”'‘’]([^"“”'‘’]{4,120})["“”'‘’]/u);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  const beforeBy = query.match(/^(.+?)\b(?:di|by)\b\s+[\p{L}][\p{L}\s.'-]{1,80}$/iu);
  if (!beforeBy?.[1]) return undefined;

  const candidate = beforeBy[1]
    .replace(/\b(approfondiamo|approfondisci|approfondire|cerca|search|talk|discorso)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = candidate.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 12) return undefined;

  return candidate;
}
