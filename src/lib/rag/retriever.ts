import { Pinecone } from "@pinecone-database/pinecone";
import { embedQuery } from "./embedder";
import type { SourceChunk, SourceType, Language } from "@/lib/types";
import {
  parseScriptureSelection,
  isWholeChapterIntent,
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

      // Retrieve chunks constrained by exact chapter metadata.
      const chapterRes = await index
        .namespace("scriptures")
        .query({
          vector,
          topK: selection.wholeBook ? 8 : 20,
          includeMetadata: true,
          filter: {
            language: { $eq: language },
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

export async function retrieve(
  query: string,
  sources: SourceType[],
  language: Language,
  topK = 20
): Promise<SourceChunk[]> {
  const scriptureSelection = parseScriptureSelection(query, language);
  const chapterChunks =
    sources.includes("scriptures")
      ? await retrieveWholeChapterChunks(query, language)
      : [];

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

  const merged = [...chapterChunks, ...results.flat()];
  const deduped = merged.filter(
    (chunk, idx, arr) => arr.findIndex((c) => c.id === chunk.id) === idx
  );

  const limit = chapterChunks.length
    ? Math.max(topK, Math.min(80, chapterChunks.length))
    : topK;

  // Flatten, sort by score descending, return top topK overall.
  return deduped.sort((a, b) => b.score - a.score).slice(0, limit);
}
