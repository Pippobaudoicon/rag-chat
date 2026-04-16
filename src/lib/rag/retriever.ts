import { Pinecone } from "@pinecone-database/pinecone";
import { embedQuery } from "./embedder";
import type { SourceChunk, SourceType, Language } from "@/lib/types";
import {
  parseScriptureSelection,
  isWholeChapterIntent,
  withVerseHighlight,
} from "./scripture-reference";

// ⚠️ CRITICAL: Index name must match Python VectorStore.INDEX_NAME = "lds-rag"
const INDEX_NAME = "lds-rag";

// Singleton Pinecone client — one per serverless instance
let _pc: Pinecone | null = null;
function getPinecone(): Pinecone {
  if (!_pc) _pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  return _pc;
}

function toChunk(
  source: SourceType,
  language: Language,
  match: {
    id: string;
    score?: number;
    metadata?: Record<string, unknown>;
  }
): SourceChunk {
  return {
    id: match.id,
    text: (match.metadata?.text ?? "") as string,
    source,
    score: match.score ?? 0,
    language,
    book: match.metadata?.book as string | undefined,
    chapter: match.metadata?.chapter as number | undefined,
    verse: match.metadata?.verse as string | undefined,
    speaker: match.metadata?.speaker as string | undefined,
    title: match.metadata?.title as string | undefined,
    date: match.metadata?.date as string | undefined,
    section: match.metadata?.section as string | undefined,
    url: match.metadata?.url as string | undefined,
  };
}

function parseVerseStart(verse?: string): number {
  if (!verse) return Number.POSITIVE_INFINITY;
  const m = verse.match(/\d+/);
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY;
}

function parseVerseBounds(verse?: string): { start: number; end: number } | null {
  if (!verse) return null;
  const m = verse.match(/(\d+)(?:\s*[-–]\s*(\d+))?/);
  if (!m) return null;

  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function verseOverlaps(
  verse: string | undefined,
  requestedStart: number,
  requestedEnd: number
): boolean {
  const bounds = parseVerseBounds(verse);
  if (!bounds) return false;
  return bounds.start <= requestedEnd && requestedStart <= bounds.end;
}

function normalizeBookName(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function maybeScripturePath(url: string | undefined): string {
  return (url ?? "").toLowerCase();
}

function isRequestedScriptureChunk(
  chunk: SourceChunk,
  canonicalBook: string,
  volumeSlug: string,
  bookSlug: string,
  chapter: number
): boolean {
  const path = maybeScripturePath(chunk.url);
  if (
    path.includes(`/study/scriptures/${volumeSlug}/${bookSlug}/${chapter}`) ||
    path.includes(`/scriptures/${volumeSlug}/${bookSlug}/${chapter}`)
  ) {
    return true;
  }

  if (!chunk.book) return false;

  const bookTokens = normalizeBookName(chunk.book);
  const canonicalTokens = normalizeBookName(canonicalBook);
  if (bookTokens.length === 0 || canonicalTokens.length === 0) return false;

  const bookFirst = bookTokens[0];
  const canonicalFirst = canonicalTokens[0];
  const hasNumericPrefix = /^\d+$/.test(bookFirst) || /^\d+$/.test(canonicalFirst);

  if (hasNumericPrefix && bookFirst !== canonicalFirst) {
    return false;
  }

  const bookSecond = bookTokens[1] ?? bookTokens[0];
  const canonicalSecond = canonicalTokens[1] ?? canonicalTokens[0];
  return bookSecond.slice(0, 2) === canonicalSecond.slice(0, 2);
}

async function retrieveWholeChapterChunks(
  query: string,
  language: Language
): Promise<SourceChunk[]> {
  const selection = parseScriptureSelection(query, language);
  if (!selection || selection.verseStart !== undefined) {
    return [];
  }

  const shouldForceStructured =
    selection.wholeBook || selection.chapters.length > 1 || isWholeChapterIntent(query);
  if (!shouldForceStructured) {
    return [];
  }

  const index = getPinecone().index(INDEX_NAME);

  const limitedChapters = selection.wholeBook
    ? selection.chapters.slice(0, 12)
    : selection.chapters.slice(0, 20);

  const chapterResults = await Promise.all(
    limitedChapters.map(async (chapter, chapterIndex) => {
      const [vector] = await Promise.all([
        embedQuery(`${selection.canonicalBook} ${chapter}`),
      ]);

      // Retrieve chunks constrained by exact book + chapter metadata.
      const chapterRes = await index
        .namespace("scriptures")
        .query({
          vector,
          topK: selection.wholeBook ? 8 : 20,
          includeMetadata: true,
          filter: {
            language: { $eq: language },
            book: { $eq: selection.canonicalBook },
            chapter: { $eq: chapter },
          },
        });

      const chapterUrl = selection.urls[chapterIndex];

      return chapterRes.matches
        .map((match) => toChunk("scriptures", language, match))
        .filter((chunk) => {
          return isRequestedScriptureChunk(
            chunk,
            selection.canonicalBook,
            selection.volumeSlug,
            selection.bookSlug,
            chapter
          );
        })
        .sort((a, b) => parseVerseStart(a.verse) - parseVerseStart(b.verse))
        .map((chunk, i) => ({
          ...chunk,
          // Keep requested chapters on top in chapter order.
          score: Math.max(chunk.score, 0.995 - chapterIndex * 0.01 - i * 0.0005),
          url: chunk.url ?? chapterUrl,
        }));
    })
  );

  return chapterResults.flat();
}

async function retrieveSpecificVerseChunks(
  query: string,
  language: Language
): Promise<SourceChunk[]> {
  const selection = parseScriptureSelection(query, language);
  if (!selection || selection.verseStart === undefined || selection.chapters.length !== 1) {
    return [];
  }

  const chapter = selection.chapters[0];
  const requestedStart = selection.verseStart;
  const requestedEnd = selection.verseEnd ?? selection.verseStart;
  const referenceQuery = `${selection.canonicalBook} ${chapter}:${requestedStart}-${requestedEnd}`;
  const index = getPinecone().index(INDEX_NAME);

  const [vector] = await Promise.all([embedQuery(referenceQuery)]);
  const res = await index
    .namespace("scriptures")
    .query({
      vector,
      topK: 48,
      includeMetadata: true,
      filter: {
        language: { $eq: language },
        book: { $eq: selection.canonicalBook },
        chapter: { $eq: chapter },
      },
    });

  const chapterUrl = selection.urls[0]; // already has verse highlight from parseScriptureSelection
  const filtered = res.matches
    .map((match) => toChunk("scriptures", language, match))
    .filter((chunk) => {
      if (
        !isRequestedScriptureChunk(
          chunk,
          selection.canonicalBook,
          selection.volumeSlug,
          selection.bookSlug,
          chapter
        )
      ) {
        return false;
      }
      return verseOverlaps(chunk.verse, requestedStart, requestedEnd);
    })
    .sort((a, b) => parseVerseStart(a.verse) - parseVerseStart(b.verse))
    .map((chunk, i) => ({
      ...chunk,
      score: Math.max(chunk.score, 0.999 - i * 0.0005),
      url: chunk.url
        ? withVerseHighlight(chunk.url, requestedStart, requestedEnd)
        : chapterUrl,
    }));

  return filtered;
}

export async function retrieve(
  query: string,
  sources: SourceType[],
  language: Language,
  topK = 20
): Promise<SourceChunk[]> {
  const scriptureSelection = parseScriptureSelection(query, language);
  const verseChunks =
    sources.includes("scriptures")
      ? await retrieveSpecificVerseChunks(query, language)
      : [];
  const chapterChunks =
    sources.includes("scriptures")
      ? await retrieveWholeChapterChunks(query, language)
      : [];

  if (scriptureSelection && verseChunks.length > 0) {
    const limit = Math.max(topK, Math.min(48, verseChunks.length));
    return verseChunks.slice(0, limit);
  }

  if (scriptureSelection && chapterChunks.length > 0) {
    const limit = Math.max(topK, Math.min(120, chapterChunks.length));
    return chapterChunks.slice(0, limit);
  }

  const [vector] = await Promise.all([embedQuery(query)]);
  const index = getPinecone().index(INDEX_NAME);

  // Query all namespaces in PARALLEL — much faster than the Python serial loop
  const results = await Promise.all(
    sources.map((source) =>
      index
        .namespace(source)
        .query({
          vector,
          topK,
          includeMetadata: true,
          // Matches Python: lang_filter = {"language": language.value}
          filter: { language: { $eq: language } },
        })
        .then((res) =>
          res.matches.map(
            (match): SourceChunk =>
              toChunk(source, language, match)
          )
        )
    )
  );

  const merged = [...verseChunks, ...chapterChunks, ...results.flat()];
  const deduped = merged.filter(
    (chunk, idx, arr) => arr.findIndex((c) => c.id === chunk.id) === idx
  );

  const limit = chapterChunks.length
    ? Math.max(topK, Math.min(80, chapterChunks.length))
    : topK;

  // Flatten, sort by score descending, return top topK overall.
  return deduped.sort((a, b) => b.score - a.score).slice(0, limit);
}
