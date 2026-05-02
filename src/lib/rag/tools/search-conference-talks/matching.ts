import type { SourceChunk } from "@/lib/types";
import { normalizeForMatch } from "../shared/text-normalize";

/**
 * Returns true when the chunk's title plausibly refers to the requested title.
 * Uses substring matching in either direction so that "Behold the Man" matches
 * "Behold the Man (April 2018)" and vice versa.
 */
export function titleMatchesRequested(
  chunkTitle: string | undefined,
  requestedTitle: string | undefined
): boolean {
  if (!requestedTitle) return true;
  const title = normalizeForMatch(chunkTitle ?? "");
  const requested = normalizeForMatch(requestedTitle);
  if (!title || !requested) return false;
  return title.includes(requested) || requested.includes(title);
}

/** Strict equality (post-normalization) between requested and chunk title. */
export function hasExactTitleEvidence(
  chunkTitle: string | undefined,
  requestedTitle: string | undefined
): boolean {
  if (!requestedTitle) return false;
  const title = normalizeForMatch(chunkTitle ?? "");
  const requested = normalizeForMatch(requestedTitle);
  if (!title || !requested) return false;
  return title === requested;
}

/**
 * Slightly looser than {@link hasExactTitleEvidence}: also accepts a chunk
 * whose title starts with the requested title (handles trailing dates/notes).
 */
export function hasConfirmedTitleEvidence(
  chunkTitle: string | undefined,
  requestedTitle: string | undefined
): boolean {
  if (!requestedTitle) return false;
  const title = normalizeForMatch(chunkTitle ?? "");
  const requested = normalizeForMatch(requestedTitle);
  if (!title || !requested) return false;
  return title === requested || title.startsWith(requested);
}

export function buildSpeakerMatcher(
  normalizedSpeaker: string | undefined
): (chunk: SourceChunk) => boolean {
  if (!normalizedSpeaker) return () => true;

  return (chunk) => {
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
}

export function buildYearMatcher(
  yearString: string | undefined
): (chunk: SourceChunk) => boolean {
  if (!yearString) return () => true;
  return (chunk) => {
    const dateText = chunk.date ?? "";
    const titleText = chunk.title ?? "";
    return dateText.includes(yearString) || titleText.includes(yearString);
  };
}
