import { Pinecone } from "@pinecone-database/pinecone";
import { embedQueries, embedQuery } from "./embedder";
import { INDEXED_LANGUAGES } from "@/lib/types";
import type { SourceChunk, SourceType, Language } from "@/lib/types";
import {
  parseScriptureSelection,
  withVerseHighlight,
} from "./scripture-reference";
import { rerankChunks } from "./reranker";
import { generateQueryVariants } from "./query-expansion";
import { getCorpusLanguageName } from "./language-routing";
import {
  isRerankEnabled,
  isDiversityEnabled,
  isMultiQueryEnabled,
} from "./flags";

// Index name must match the ingestion target. Defaults to "lds-rag-v1" (the
// English-main corpus with study_helps + graph related_ids); override with
// PINECONE_INDEX to point at a different build.
const INDEX_NAME = process.env.PINECONE_INDEX ?? "lds-rag-v1";

// Singleton Pinecone client — one per serverless instance
let _pc: Pinecone | null = null;
function getPinecone(): Pinecone {
  if (!_pc) _pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  return _pc;
}

function enrichScriptureUrl(
  url: string | undefined,
  verse: string | undefined,
  source: SourceType
): string | undefined {
  if (!url || !verse || source !== "scriptures") return url;
  const bounds = parseVerseBounds(verse);
  if (!bounds) return url;
  return withVerseHighlight(url, bounds.start, bounds.end);
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
  const rawUrl = match.metadata?.url as string | undefined;
  const verse = match.metadata?.verse as string | undefined;
  return {
    id: match.id,
    text: (match.metadata?.text ?? "") as string,
    source,
    score: match.score ?? 0,
    language,
    book: match.metadata?.book as string | undefined,
    chapter: match.metadata?.chapter as number | undefined,
    verse,
    speaker: match.metadata?.speaker as string | undefined,
    title: match.metadata?.title as string | undefined,
    date: match.metadata?.date as string | undefined,
    section: match.metadata?.section as string | undefined,
    url: enrichScriptureUrl(rawUrl, verse, source),
    relatedIds: (match.metadata?.related_ids as string[] | undefined) ?? undefined,
    summary: (match.metadata?.summary as string | undefined) || undefined,
    topics: (match.metadata?.topics as string[] | undefined) ?? undefined,
    entities: toEntities(match.metadata),
    references: (match.metadata?.references as string[] | undefined) ?? undefined,
  };
}

function toEntities(
  metadata?: Record<string, unknown>
): SourceChunk["entities"] | undefined {
  if (!metadata) return undefined;
  const people = metadata.entities_people as string[] | undefined;
  const places = metadata.entities_places as string[] | undefined;
  const doctrines = metadata.entities_doctrines as string[] | undefined;
  if (!people && !places && !doctrines) return undefined;
  return { people, places, doctrines };
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

function orderRetrievalLanguages(answerLanguage: Language): Language[] {
  return [
    answerLanguage,
    ...INDEXED_LANGUAGES.filter((language) => language !== answerLanguage),
  ];
}

function tokenizeForBoost(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

// Small lexical boost when the query's terms overlap a chunk's enriched topics /
// entities. Refines ordering among semantically-close candidates without
// overriding the vector score. Capped so it can't dominate relevance.
function topicEntityBoost(queryTokens: Set<string>, chunk: SourceChunk): number {
  const terms = [
    ...(chunk.topics ?? []),
    ...(chunk.entities?.doctrines ?? []),
    ...(chunk.entities?.people ?? []),
    ...(chunk.entities?.places ?? []),
  ];
  if (terms.length === 0) return 0;
  let hits = 0;
  for (const term of terms) {
    if (tokenizeForBoost(term).some((token) => queryTokens.has(token))) hits += 1;
  }
  return Math.min(0.04, hits * 0.01);
}

function mergeChunks(chunks: SourceChunk[]): SourceChunk[] {
  return chunks.filter(
    (chunk, idx, arr) => arr.findIndex((candidate) => candidate.id === chunk.id) === idx
  );
}

// Chunk ids are `<namespace>:<language>:<rest…>` (e.g.
// `scriptures:eng:exodus:18:12-21:v1`, `conference:ita:2019:04:slug:c1:v1`).
// The slug/chapter/verse (or year/session/slug) segments are language-invariant,
// so dropping the language segment yields a key shared by the SAME logical unit
// across languages — the join between an English verse and its Italian translation.
function languageInvariantKey(id: string): string {
  const parts = id.split(":");
  if (parts.length < 3) return id;
  return [parts[0], ...parts.slice(2)].join(":");
}

// Scriptures and talks are indexed in every corpus language, so the topical
// fan-out over `retrievalLanguages` returns each passage twice — e.g. Exodus 18
// in English AND Esodo 18 in Italian, as two chunks with distinct ids that
// `mergeChunks` (id-exact) never collapses. That doubles the source count and
// spends half the top-k budget on redundant translations of the same text.
// Collapse each cross-language group to one chunk, keeping the answer-language
// copy (so the reader sees their language) at the group's best score (so its
// rank is preserved). Passages indexed in only one language, or chunked into
// different verse ranges across languages, have no partner and pass through.
export function collapseCrossLanguage(
  chunks: SourceChunk[],
  preferredLanguage: Language
): SourceChunk[] {
  const byKey = new Map<string, SourceChunk>();
  const order: string[] = [];
  for (const chunk of chunks) {
    const key = languageInvariantKey(chunk.id);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, chunk);
      order.push(key);
      continue;
    }
    const bestScore = Math.max(existing.score, chunk.score);
    const preferIncoming =
      chunk.language === preferredLanguage && existing.language !== preferredLanguage;
    const winner = preferIncoming ? chunk : existing;
    byKey.set(key, winner.score === bestScore ? winner : { ...winner, score: bestScore });
  }
  return order.map((key) => byKey.get(key)!);
}

/** Keep non-scripture chunks plus scriptures in the requested indexed language. */
export function filterScripturesByLanguage(
  chunks: SourceChunk[],
  language: Language
): SourceChunk[] {
  return chunks.filter(
    (chunk) => chunk.source !== "scriptures" || chunk.language === language
  );
}

function sortRetrievedChunks(chunks: SourceChunk[], preferredLanguage: Language): SourceChunk[] {
  return chunks.sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (Math.abs(scoreDelta) > 0.01) return scoreDelta;
    if (a.language === preferredLanguage && b.language !== preferredLanguage) return -1;
    if (b.language === preferredLanguage && a.language !== preferredLanguage) return 1;
    return scoreDelta;
  });
}

// Diversity caps applied within the returned top-k so one namespace or one
// talk/chapter cannot crowd out complementary evidence. Chunks over a cap are
// not dropped — they spill to the end so the caller's slice can still backfill
// if the caps would otherwise leave the top-k short.
const MAX_PER_SOURCE = 6;
const MAX_PER_TITLE = 3;

function diversify(sorted: SourceChunk[], limit: number): SourceChunk[] {
  const perSource = new Map<SourceType, number>();
  const perTitle = new Map<string, number>();
  const picked: SourceChunk[] = [];
  const overflow: SourceChunk[] = [];

  for (const chunk of sorted) {
    const sourceCount = perSource.get(chunk.source) ?? 0;
    const titleKey = chunk.title ?? chunk.book ?? chunk.id;
    const titleCount = perTitle.get(titleKey) ?? 0;

    if (picked.length < limit && sourceCount < MAX_PER_SOURCE && titleCount < MAX_PER_TITLE) {
      picked.push(chunk);
      perSource.set(chunk.source, sourceCount + 1);
      perTitle.set(titleKey, titleCount + 1);
    } else {
      overflow.push(chunk);
    }
  }

  return [...picked, ...overflow];
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
  // Primary, language-invariant signal: the chunk id encodes the book slug as
  // its 3rd segment (`scriptures:<lang>:<bookSlug>:<chapter>:…`). This is the
  // same slug parseScriptureSelection yields, so it matches regardless of the
  // chunk's display-language book name. (Chapter is already constrained by the
  // Pinecone metadata filter at every call site.)
  if (chunk.id.split(":")[2] === bookSlug) {
    return true;
  }

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

  // Any chapter-level reference ("Alma 32", "2 Nephi 2") should retrieve that
  // exact chapter structurally — not lean on semantic similarity, which surfaces
  // neighboring chapters and mixes in the other indexed language.
  const index = getPinecone().index(INDEX_NAME);

  const limitedChapters = selection.wholeBook
    ? selection.chapters.slice(0, 12)
    : selection.chapters.slice(0, 20);

  const chapterResults = await Promise.all(
    limitedChapters.map(async (chapter, chapterIndex) => {
      const [vector] = await Promise.all([embedQuery(`${query} ${chapter}`)]);

      // Constrain by language-invariant signals (language + chapter); the book
      // is enforced by the slug-based post-filter below. We do NOT filter on the
      // `book` metadata because it is the display name in the chunk's language
      // (e.g. "Giovanni" vs "John"), which would not match across languages.
      // topK is generous so the requested book's verses are captured among all
      // same-chapter chunks before the post-filter narrows to the right book.
      const chapterRes = await index
        .namespace("scriptures")
        .query({
          vector,
          topK: selection.wholeBook ? 40 : 80,
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

async function retrievePreferredLanguage(
  fn: (query: string, language: Language) => Promise<SourceChunk[]>,
  query: string,
  languages: Language[]
): Promise<SourceChunk[]> {
  // Try languages in preference order (answer language first); return the first
  // non-empty result so an English question yields English scripture.
  for (const language of languages) {
    const chunks = await fn(query, language);
    if (chunks.length > 0) return chunks;
  }
  return [];
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
  // Embed the user's reference (already in the index language) rather than the
  // Italian canonicalBook, so ranking favors the requested book's verses.
  const referenceQuery = `${query} ${chapter}:${requestedStart}-${requestedEnd}`;
  const index = getPinecone().index(INDEX_NAME);

  const [vector] = await Promise.all([embedQuery(referenceQuery)]);
  // Constrain by language + chapter only; the book is enforced by the
  // slug-based post-filter (see isRequestedScriptureChunk). Filtering on the
  // `book` metadata would fail across languages ("Giovanni" vs "John").
  const res = await index
    .namespace("scriptures")
    .query({
      vector,
      topK: 80,
      includeMetadata: true,
      filter: {
        language: { $eq: language },
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

export interface RetrieveOptions {
  /** Override RAG_RERANK for this call (eval A/B). Defaults to the env flag. */
  rerank?: boolean;
  /** Override RAG_MMR for this call. Defaults to the env flag. */
  diversity?: boolean;
  /** Override RAG_MULTI_QUERY for this call. Defaults to the env flag. */
  multiQuery?: boolean;
  /** Restrict scripture chunks to this indexed prompt language. */
  scriptureLanguage?: Language;
}

export async function retrieve(
  query: string,
  sources: SourceType[],
  language: Language,
  topK = 20,
  options: RetrieveOptions = {}
): Promise<SourceChunk[]> {
  // Rerank the candidate pool when enabled. In production the query reaching the
  // cross-encoder is already translated into the index language (see route.ts
  // language routing), so there is no per-input-language quality split to gate on.
  const useRerank = options.rerank ?? isRerankEnabled();
  const useDiversity = options.diversity ?? isDiversityEnabled();
  const useMultiQuery = options.multiQuery ?? isMultiQueryEnabled();
  const scriptureLanguage = options.scriptureLanguage ?? language;

  const retrievalLanguages = orderRetrievalLanguages(language);
  const scriptureRetrievalLanguages = options.scriptureLanguage
    ? [scriptureLanguage]
    : orderRetrievalLanguages(scriptureLanguage);
  const scriptureSelection = parseScriptureSelection(query, scriptureLanguage);
  // Scriptures are bilingual (eng+ita) in the index. Prefer the answer language:
  // use it if it has the passage, and only fall back to another language if empty.
  const verseChunks = sources.includes("scriptures")
    ? await retrievePreferredLanguage(retrieveSpecificVerseChunks, query, scriptureRetrievalLanguages)
    : [];
  const chapterChunks = sources.includes("scriptures")
    ? await retrievePreferredLanguage(retrieveWholeChapterChunks, query, scriptureRetrievalLanguages)
    : [];

  if (scriptureSelection && verseChunks.length > 0) {
    const limit = Math.max(topK, Math.min(48, verseChunks.length));
    return verseChunks.slice(0, limit);
  }

  if (scriptureSelection && chapterChunks.length > 0) {
    const limit = Math.max(topK, Math.min(topK * 2, chapterChunks.length));
    return chapterChunks.slice(0, limit);
  }

  // Multi-query expansion: fan a few phrasings (canonical LDS wording + plainer
  // rewording) across the namespaces and merge, lifting recall before rerank.
  const queries = useMultiQuery
    ? [query, ...(await generateQueryVariants(query, getCorpusLanguageName(language)))]
    : [query];
  const vectors = await embedQueries(queries);
  const index = getPinecone().index(INDEX_NAME);

  // Query all variants × selected namespaces × indexed languages in parallel.
  // The UI language controls the answer, but retrieval can use any corpus language.
  const results = await Promise.all(
    vectors.flatMap((vector) =>
      sources.flatMap((source) =>
        (source === "scriptures" ? [scriptureLanguage] : retrievalLanguages).map((retrievalLanguage) =>
          index
            .namespace(source)
            .query({
              vector,
              topK,
              includeMetadata: true,
              filter: { language: { $eq: retrievalLanguage } },
            })
            .then((res) =>
              res.matches.map(
                (match): SourceChunk =>
                  toChunk(source, retrievalLanguage, match)
              )
            )
        )
      )
    )
  );

  const merged = [...verseChunks, ...chapterChunks, ...results.flat()];
  // First collapse id-exact repeats, then collapse the same passage across
  // languages (bilingual index) so the top-k holds distinct content, not
  // English+Italian copies of one verse. Prefer the answer language.
  const deduped = collapseCrossLanguage(mergeChunks(merged), language);

  // Cross-encoder rerank (flag-gated): scores every candidate against the query
  // directly, calibrating relevance across namespaces/languages. Primary sort
  // signal when enabled; the topic/entity boost below is a small secondary nudge.
  const reranked = useRerank ? await rerankChunks(query, deduped) : deduped;

  // Light lexical nudge: bump chunks whose enriched topics/entities match query terms.
  const queryTokens = new Set(tokenizeForBoost(query));
  const boosted = reranked.map((chunk) => {
    const boost = topicEntityBoost(queryTokens, chunk);
    return boost > 0 ? { ...chunk, score: Math.min(0.999, chunk.score + boost) } : chunk;
  });

  const limit = chapterChunks.length
    ? Math.max(topK, Math.min(topK * 2, chapterChunks.length))
    : topK;

  // Sort by score descending; optionally apply per-source/per-title diversity
  // caps so one namespace or talk cannot dominate the returned top-k.
  const sorted = sortRetrievedChunks(boosted, language);
  const diversified = useDiversity ? diversify(sorted, limit) : sorted;
  return diversified.slice(0, limit);
}

export async function retrieveConferenceCandidates(
  queries: string[],
  language: Language,
  topK = 20
): Promise<SourceChunk[]> {
  const candidates = queries.filter((query) => query.trim().length > 0);
  if (candidates.length === 0) return [];

  const retrievalLanguages = orderRetrievalLanguages(language);
  const vectors = await embedQueries(candidates);
  const index = getPinecone().index(INDEX_NAME);

  const candidateResults = await Promise.all(
    vectors.map(async (vector) => {
      const languageResults = await Promise.all(
        retrievalLanguages.map((retrievalLanguage) =>
          index
            .namespace("conference")
            .query({
              vector,
              topK,
              includeMetadata: true,
              filter: { language: { $eq: retrievalLanguage } },
            })
            .then((res) =>
              res.matches.map(
                (match): SourceChunk =>
                  toChunk("conference", retrievalLanguage, match)
              )
            )
        )
      );

      return sortRetrievedChunks(
        mergeChunks(languageResults.flat()),
        language
      ).slice(0, topK);
    })
  );

  return mergeChunks(candidateResults.flat());
}

// A conference talk is fully identified by its chunk-id prefix
// `conference:<lang>:<year>:<session>:<slug>` (chunks add `:c<n>:v<n>`).
export function conferenceTalkKey(chunkId: string): string {
  return chunkId.split(":").slice(0, 5).join(":");
}

// Sort key for a talk's chunks: `:c<chapter>:v<verse>` → reading order.
function conferenceChunkOrder(chunkId: string): number {
  const m = chunkId.match(/:c(\d+):v(\d+)$/);
  return m ? Number(m[1]) * 1000 + Number(m[2]) : Number.MAX_SAFE_INTEGER;
}

/**
 * Fetch the COMPLETE set of chunks for a single conference talk, identified by
 * its id prefix (see {@link conferenceTalkKey}), in reading order. Used to turn
 * a semantic title match into a deterministic, whole-talk result — instead of
 * whatever partial slice semantic search happened to surface. Prefix listing is
 * authoritative (it enumerates exactly that talk's vectors), so the talk is
 * returned complete and in order.
 */
export async function fetchConferenceTalkChunks(
  talkKey: string,
  fallbackLanguage: Language
): Promise<SourceChunk[]> {
  const ns = getPinecone().index(INDEX_NAME).namespace("conference");

  const ids: string[] = [];
  let token: string | undefined;
  do {
    const page = await ns.listPaginated({ prefix: `${talkKey}:`, paginationToken: token });
    for (const v of page.vectors ?? []) if (v.id) ids.push(v.id);
    token = page.pagination?.next;
  } while (token && ids.length < 200); // safety cap: talks are ~7 chunks
  if (ids.length === 0) return [];

  const res = await ns.fetch({ ids });
  const records =
    (res as { records?: Record<string, { id: string; metadata?: Record<string, unknown> }> })
      .records ?? {};

  return Object.values(records)
    .sort((a, b) => conferenceChunkOrder(a.id) - conferenceChunkOrder(b.id))
    .map((rec, i) => {
      const language = ((rec.metadata?.language as string) ?? fallbackLanguage) as Language;
      // High, descending scores keep the talk on top and in reading order.
      return toChunk("conference", language, {
        id: rec.id,
        score: 0.99 - i * 0.0005,
        metadata: rec.metadata,
      });
    });
}

// Fixed score for graph-related context (below a directly-matched passage, so
// these read as supporting cross-references rather than primary hits).
const RELATED_CHUNK_SCORE = 0.55;

/**
 * Fetch related chunks by id (the cross-reference graph projection stored in
 * `related_ids`). Ids encode their namespace as the first segment
 * (`scriptures:…`, `study_helps:…`), so we group and fetch per namespace.
 * Used to expand a scripture passage with its footnote/topic cross-references
 * and study-help entries for fuller, scholar-grade context.
 */
export async function fetchRelatedChunks(
  ids: string[],
  fallbackLanguage: Language
): Promise<SourceChunk[]> {
  if (ids.length === 0) return [];
  const index = getPinecone().index(INDEX_NAME);

  const byNamespace = new Map<string, string[]>();
  for (const id of ids) {
    const namespace = id.split(":")[0];
    if (!namespace) continue;
    (byNamespace.get(namespace) ?? byNamespace.set(namespace, []).get(namespace)!).push(id);
  }

  const groups = await Promise.all(
    [...byNamespace.entries()].map(async ([namespace, nsIds]) => {
      try {
        const res = await index.namespace(namespace).fetch({ ids: nsIds });
        const records =
          (res as { records?: Record<string, { id: string; metadata?: Record<string, unknown> }> })
            .records ?? {};
        return Object.values(records).map((rec) => {
          const language = ((rec.metadata?.language as string) ?? fallbackLanguage) as Language;
          return toChunk(namespace as SourceType, language, {
            id: rec.id,
            score: RELATED_CHUNK_SCORE,
            metadata: rec.metadata,
          });
        });
      } catch {
        return [] as SourceChunk[];
      }
    })
  );

  return groups.flat();
}

/**
 * Resolve scripture cross-references whose exact localized id is absent because
 * the target language chunked the same verses into different ranges (e.g. an
 * English `scriptures:eng:jacob:4:1-5` has no `scriptures:ita:jacob:4:1-5`).
 * Resolve by canonical slug + chapter: list that chapter's chunks in the target
 * language by id prefix, then keep the ones whose verse range overlaps the
 * requested range. No translation — pure id/metadata matching.
 *
 * Input ids are already in the target language (`scriptures:<language>:<slug>:<chapter>:<verses>:…`).
 */
export async function fetchLocalizedScriptureRefs(
  ids: string[],
  language: Language
): Promise<SourceChunk[]> {
  if (ids.length === 0) return [];
  const ns = getPinecone().index(INDEX_NAME).namespace("scriptures");

  // Group requested verse ranges by `<slug>:<chapter>` so each chapter is listed once.
  const byChapter = new Map<string, Array<{ start: number; end: number }>>();
  for (const id of ids) {
    const p = id.split(":"); // scriptures:lang:slug:chapter:verseRange:v1
    if (p[0] !== "scriptures" || p.length < 5) continue;
    const bounds = parseVerseBounds(p[4]);
    if (!bounds) continue;
    const key = `${p[2]}:${p[3]}`;
    (byChapter.get(key) ?? byChapter.set(key, []).get(key)!).push(bounds);
  }

  const groups = await Promise.all(
    [...byChapter.entries()].map(async ([key, ranges]) => {
      try {
        const prefix = `scriptures:${language}:${key}:`;
        const candidateIds: string[] = [];
        let token: string | undefined;
        do {
          const page = await ns.listPaginated({ prefix, paginationToken: token });
          for (const v of page.vectors ?? []) if (v.id) candidateIds.push(v.id);
          token = page.pagination?.next;
        } while (token && candidateIds.length < 60); // safety cap per chapter
        if (candidateIds.length === 0) return [] as SourceChunk[];

        const res = await ns.fetch({ ids: candidateIds });
        const records =
          (res as { records?: Record<string, { id: string; metadata?: Record<string, unknown> }> })
            .records ?? {};
        return Object.values(records)
          .map((rec) =>
            toChunk("scriptures", (rec.metadata?.language as Language) ?? language, {
              id: rec.id,
              score: RELATED_CHUNK_SCORE,
              metadata: rec.metadata,
            })
          )
          .filter((chunk) => ranges.some((r) => verseOverlaps(chunk.verse, r.start, r.end)));
      } catch {
        return [] as SourceChunk[];
      }
    })
  );
  return groups.flat();
}
