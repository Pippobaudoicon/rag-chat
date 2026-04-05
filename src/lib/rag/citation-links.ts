import type { SourceChunk } from "@/lib/types";

function getCitationUrl(index: number, sources: SourceChunk[]): string | null {
  if (!Number.isInteger(index) || index <= 0) return null;
  const source = sources[index - 1];
  if (!source?.url) return null;
  return source.url;
}

function normalizeBareCitationTail(text: string, maxSources: number): string {
  // Some model outputs end with bare digits like "1234" instead of "[1][2][3][4]".
  // We only normalize the tail to avoid rewriting legitimate numbers in prose.
  return text.replace(/\s(\d{2,12})([.!?]?)\s*$/, (full: string, digits: string, punctuation: string) => {
    if (!/^\d+$/.test(digits)) return full;
    const pieces: number[] = digits.split("").map((d: string) => Number(d));
    if (pieces.some((n: number) => n <= 0 || n > Math.min(9, maxSources))) {
      return full;
    }
    const rebuilt = pieces.map((n: number) => `[${n}]`).join("");
    return ` ${rebuilt}${punctuation}`;
  });
}

export function linkifyInlineCitations(
  text: string,
  sources?: SourceChunk[]
): string {
  if (!sources || sources.length === 0) {
    return text;
  }

  const normalizedText = normalizeBareCitationTail(text, sources.length);
  if (!normalizedText.includes("[")) return normalizedText;

  // Convert [Source N] and [N] into markdown links when URL is available.
  return normalizedText.replace(/\[(?:source\s+)?(\d+)\](?!\()/gi, (full: string, rawIndex: string) => {
    const index = Number(rawIndex);
    const url = getCitationUrl(index, sources);
    if (!url) return full;
    // Markdown link labels drop literal brackets unless escaped.
    // This keeps the visible citation style as [1], [2], ...
    return `[\\[${index}\\]](${url})`;
  });
}
