import type { Language } from "@/lib/types";

export interface ScriptureReference {
  volumeSlug: string;
  bookSlug: string;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
  canonicalBook: string;
  url: string;
}

export interface ScriptureReferenceSelection {
  volumeSlug: string;
  bookSlug: string;
  canonicalBook: string;
  chapters: number[];
  verseStart?: number;
  verseEnd?: number;
  urls: string[];
  wholeBook: boolean;
}

interface ScriptureBookDef {
  volumeSlug: string;
  bookSlug: string;
  canonicalBook: string;
  maxChapters: number;
  aliases: string[];
}

const CHURCH_SCRIPTURES_BASE =
  "https://www.churchofjesuschrist.org/study/scriptures";

// Focused on the most commonly queried books first, with aliases in ITA/ENG.
const SCRIPTURE_BOOKS: ScriptureBookDef[] = [
  // ── Book of Mormon ─────────────────────────────────────────────────
  { volumeSlug: "bofm", bookSlug: "1-ne", canonicalBook: "1 Nefi", maxChapters: 22, aliases: ["1 nefi", "1 nephi", "primo nefi", "first nephi"] },
  { volumeSlug: "bofm", bookSlug: "2-ne", canonicalBook: "2 Nefi", maxChapters: 33, aliases: ["2 nefi", "2 nephi", "secondo nefi", "second nephi"] },
  { volumeSlug: "bofm", bookSlug: "jacob", canonicalBook: "Giacobbe", maxChapters: 7, aliases: ["giacobbe", "jacob"] },
  { volumeSlug: "bofm", bookSlug: "enos", canonicalBook: "Enos", maxChapters: 1, aliases: ["enos"] },
  { volumeSlug: "bofm", bookSlug: "jarom", canonicalBook: "Jarom", maxChapters: 1, aliases: ["jarom"] },
  { volumeSlug: "bofm", bookSlug: "omni", canonicalBook: "Omni", maxChapters: 1, aliases: ["omni"] },
  { volumeSlug: "bofm", bookSlug: "w-of-m", canonicalBook: "Parole di Mormon", maxChapters: 1, aliases: ["parole di mormon", "parole mormon", "words of mormon", "w of m"] },
  { volumeSlug: "bofm", bookSlug: "mosiah", canonicalBook: "Mosia", maxChapters: 29, aliases: ["mosia", "mosiah"] },
  { volumeSlug: "bofm", bookSlug: "alma", canonicalBook: "Alma", maxChapters: 63, aliases: ["alma"] },
  { volumeSlug: "bofm", bookSlug: "hel", canonicalBook: "Helaman", maxChapters: 16, aliases: ["helaman", "hel"] },
  { volumeSlug: "bofm", bookSlug: "3-ne", canonicalBook: "3 Nefi", maxChapters: 30, aliases: ["3 nefi", "3 nephi", "terzo nefi", "third nephi"] },
  { volumeSlug: "bofm", bookSlug: "4-ne", canonicalBook: "4 Nefi", maxChapters: 1, aliases: ["4 nefi", "4 nephi", "quarto nefi", "fourth nephi"] },
  { volumeSlug: "bofm", bookSlug: "morm", canonicalBook: "Mormon", maxChapters: 9, aliases: ["mormon"] },
  { volumeSlug: "bofm", bookSlug: "ether", canonicalBook: "Ether", maxChapters: 15, aliases: ["ether", "etere"] },
  { volumeSlug: "bofm", bookSlug: "moro", canonicalBook: "Moroni", maxChapters: 10, aliases: ["moroni", "moro"] },

  // ── Doctrine & Covenants ───────────────────────────────────────────
  { volumeSlug: "dc-testament", bookSlug: "dc", canonicalBook: "Dottrina e Alleanze", maxChapters: 138, aliases: ["dottrina e alleanze", "dottrina alleanze", "dottrina & alleanze", "d&a", "da", "d c", "dc", "doctrine and covenants", "d&c"] },

  // ── Pearl of Great Price ───────────────────────────────────────────
  { volumeSlug: "pgp", bookSlug: "moses", canonicalBook: "Mosè", maxChapters: 8, aliases: ["mose", "mosè", "moses"] },
  { volumeSlug: "pgp", bookSlug: "abr", canonicalBook: "Abrahamo", maxChapters: 5, aliases: ["abrahamo", "abraham"] },
  { volumeSlug: "pgp", bookSlug: "js-m", canonicalBook: "Joseph Smith-Matteo", maxChapters: 1, aliases: ["joseph smith matteo", "joseph smith matthew", "js-m", "js m"] },
  { volumeSlug: "pgp", bookSlug: "js-h", canonicalBook: "Joseph Smith-Storia", maxChapters: 1, aliases: ["joseph smith storia", "joseph smith history", "js-h", "js h"] },
  { volumeSlug: "pgp", bookSlug: "a-of-f", canonicalBook: "Articoli di Fede", maxChapters: 1, aliases: ["articoli di fede", "articles of faith", "a of f"] },

  // ── Old Testament ──────────────────────────────────────────────────
  { volumeSlug: "ot", bookSlug: "gen", canonicalBook: "Genesi", maxChapters: 50, aliases: ["genesi", "genesis", "gen"] },
  { volumeSlug: "ot", bookSlug: "ex", canonicalBook: "Esodo", maxChapters: 40, aliases: ["esodo", "exodus", "ex"] },
  { volumeSlug: "ot", bookSlug: "lev", canonicalBook: "Levitico", maxChapters: 27, aliases: ["levitico", "leviticus", "lev"] },
  { volumeSlug: "ot", bookSlug: "num", canonicalBook: "Numeri", maxChapters: 36, aliases: ["numeri", "numbers", "num"] },
  { volumeSlug: "ot", bookSlug: "deut", canonicalBook: "Deuteronomio", maxChapters: 34, aliases: ["deuteronomio", "deuteronomy", "deut"] },
  { volumeSlug: "ot", bookSlug: "josh", canonicalBook: "Giosuè", maxChapters: 24, aliases: ["giosue", "giosuè", "joshua", "josh"] },
  { volumeSlug: "ot", bookSlug: "judg", canonicalBook: "Giudici", maxChapters: 21, aliases: ["giudici", "judges", "judg"] },
  { volumeSlug: "ot", bookSlug: "ruth", canonicalBook: "Rut", maxChapters: 4, aliases: ["rut", "ruth"] },
  { volumeSlug: "ot", bookSlug: "1-sam", canonicalBook: "1 Samuele", maxChapters: 31, aliases: ["1 samuele", "1 samuel", "primo samuele", "first samuel"] },
  { volumeSlug: "ot", bookSlug: "2-sam", canonicalBook: "2 Samuele", maxChapters: 24, aliases: ["2 samuele", "2 samuel", "secondo samuele", "second samuel"] },
  { volumeSlug: "ot", bookSlug: "1-kgs", canonicalBook: "1 Re", maxChapters: 22, aliases: ["1 re", "1 kings", "primo re", "first kings"] },
  { volumeSlug: "ot", bookSlug: "2-kgs", canonicalBook: "2 Re", maxChapters: 25, aliases: ["2 re", "2 kings", "secondo re", "second kings"] },
  { volumeSlug: "ot", bookSlug: "1-chr", canonicalBook: "1 Cronache", maxChapters: 29, aliases: ["1 cronache", "1 chronicles", "primo cronache", "first chronicles"] },
  { volumeSlug: "ot", bookSlug: "2-chr", canonicalBook: "2 Cronache", maxChapters: 36, aliases: ["2 cronache", "2 chronicles", "secondo cronache", "second chronicles"] },
  { volumeSlug: "ot", bookSlug: "ezra", canonicalBook: "Esdra", maxChapters: 10, aliases: ["esdra", "ezra"] },
  { volumeSlug: "ot", bookSlug: "neh", canonicalBook: "Neemia", maxChapters: 13, aliases: ["neemia", "nehemiah", "neh"] },
  { volumeSlug: "ot", bookSlug: "esth", canonicalBook: "Ester", maxChapters: 10, aliases: ["ester", "esther", "esth"] },
  { volumeSlug: "ot", bookSlug: "job", canonicalBook: "Giobbe", maxChapters: 42, aliases: ["giobbe", "job"] },
  { volumeSlug: "ot", bookSlug: "ps", canonicalBook: "Salmi", maxChapters: 150, aliases: ["salmi", "salmo", "psalms", "psalm", "ps"] },
  { volumeSlug: "ot", bookSlug: "prov", canonicalBook: "Proverbi", maxChapters: 31, aliases: ["proverbi", "proverbs", "prov"] },
  { volumeSlug: "ot", bookSlug: "eccl", canonicalBook: "Ecclesiaste", maxChapters: 12, aliases: ["ecclesiaste", "ecclesiastes", "eccl"] },
  { volumeSlug: "ot", bookSlug: "song", canonicalBook: "Cantico dei Cantici", maxChapters: 8, aliases: ["cantico dei cantici", "cantico", "song of solomon", "song"] },
  { volumeSlug: "ot", bookSlug: "isa", canonicalBook: "Isaia", maxChapters: 66, aliases: ["isaia", "isaiah", "isa"] },
  { volumeSlug: "ot", bookSlug: "jer", canonicalBook: "Geremia", maxChapters: 52, aliases: ["geremia", "jeremiah", "jer"] },
  { volumeSlug: "ot", bookSlug: "lam", canonicalBook: "Lamentazioni", maxChapters: 5, aliases: ["lamentazioni", "lamentations", "lam"] },
  { volumeSlug: "ot", bookSlug: "ezek", canonicalBook: "Ezechiele", maxChapters: 48, aliases: ["ezechiele", "ezekiel", "ezek"] },
  { volumeSlug: "ot", bookSlug: "dan", canonicalBook: "Daniele", maxChapters: 12, aliases: ["daniele", "daniel", "dan"] },
  { volumeSlug: "ot", bookSlug: "hosea", canonicalBook: "Osea", maxChapters: 14, aliases: ["osea", "hosea"] },
  { volumeSlug: "ot", bookSlug: "joel", canonicalBook: "Gioele", maxChapters: 3, aliases: ["gioele", "joel"] },
  { volumeSlug: "ot", bookSlug: "amos", canonicalBook: "Amos", maxChapters: 9, aliases: ["amos"] },
  { volumeSlug: "ot", bookSlug: "obad", canonicalBook: "Abdia", maxChapters: 1, aliases: ["abdia", "obadiah", "obad"] },
  { volumeSlug: "ot", bookSlug: "jonah", canonicalBook: "Giona", maxChapters: 4, aliases: ["giona", "jonah"] },
  { volumeSlug: "ot", bookSlug: "micah", canonicalBook: "Michea", maxChapters: 7, aliases: ["michea", "micah"] },
  { volumeSlug: "ot", bookSlug: "nahum", canonicalBook: "Naum", maxChapters: 3, aliases: ["naum", "nahum"] },
  { volumeSlug: "ot", bookSlug: "hab", canonicalBook: "Abacuc", maxChapters: 3, aliases: ["abacuc", "habakkuk", "hab"] },
  { volumeSlug: "ot", bookSlug: "zeph", canonicalBook: "Sofonia", maxChapters: 3, aliases: ["sofonia", "zephaniah", "zeph"] },
  { volumeSlug: "ot", bookSlug: "hag", canonicalBook: "Aggeo", maxChapters: 2, aliases: ["aggeo", "haggai", "hag"] },
  { volumeSlug: "ot", bookSlug: "zech", canonicalBook: "Zaccaria", maxChapters: 14, aliases: ["zaccaria", "zechariah", "zech"] },
  { volumeSlug: "ot", bookSlug: "mal", canonicalBook: "Malachia", maxChapters: 4, aliases: ["malachia", "malachi", "mal"] },

  // ── New Testament ──────────────────────────────────────────────────
  { volumeSlug: "nt", bookSlug: "matt", canonicalBook: "Matteo", maxChapters: 28, aliases: ["matteo", "matthew", "matt"] },
  { volumeSlug: "nt", bookSlug: "mark", canonicalBook: "Marco", maxChapters: 16, aliases: ["marco", "mark"] },
  { volumeSlug: "nt", bookSlug: "luke", canonicalBook: "Luca", maxChapters: 24, aliases: ["luca", "luke"] },
  { volumeSlug: "nt", bookSlug: "john", canonicalBook: "Giovanni", maxChapters: 21, aliases: ["giovanni", "john"] },
  { volumeSlug: "nt", bookSlug: "acts", canonicalBook: "Atti", maxChapters: 28, aliases: ["atti", "acts"] },
  { volumeSlug: "nt", bookSlug: "rom", canonicalBook: "Romani", maxChapters: 16, aliases: ["romani", "romans", "rom"] },
  { volumeSlug: "nt", bookSlug: "1-cor", canonicalBook: "1 Corinzi", maxChapters: 16, aliases: ["1 corinzi", "1 corinthians", "primo corinzi", "first corinthians"] },
  { volumeSlug: "nt", bookSlug: "2-cor", canonicalBook: "2 Corinzi", maxChapters: 13, aliases: ["2 corinzi", "2 corinthians", "secondo corinzi", "second corinthians"] },
  { volumeSlug: "nt", bookSlug: "gal", canonicalBook: "Galati", maxChapters: 6, aliases: ["galati", "galatians", "gal"] },
  { volumeSlug: "nt", bookSlug: "eph", canonicalBook: "Efesini", maxChapters: 6, aliases: ["efesini", "ephesians", "eph"] },
  { volumeSlug: "nt", bookSlug: "philip", canonicalBook: "Filippesi", maxChapters: 4, aliases: ["filippesi", "philippians", "philip"] },
  { volumeSlug: "nt", bookSlug: "col", canonicalBook: "Colossesi", maxChapters: 4, aliases: ["colossesi", "colossians", "col"] },
  { volumeSlug: "nt", bookSlug: "1-thes", canonicalBook: "1 Tessalonicesi", maxChapters: 5, aliases: ["1 tessalonicesi", "1 thessalonians", "primo tessalonicesi", "first thessalonians"] },
  { volumeSlug: "nt", bookSlug: "2-thes", canonicalBook: "2 Tessalonicesi", maxChapters: 3, aliases: ["2 tessalonicesi", "2 thessalonians", "secondo tessalonicesi", "second thessalonians"] },
  { volumeSlug: "nt", bookSlug: "1-tim", canonicalBook: "1 Timoteo", maxChapters: 6, aliases: ["1 timoteo", "1 timothy", "primo timoteo", "first timothy"] },
  { volumeSlug: "nt", bookSlug: "2-tim", canonicalBook: "2 Timoteo", maxChapters: 4, aliases: ["2 timoteo", "2 timothy", "secondo timoteo", "second timothy"] },
  { volumeSlug: "nt", bookSlug: "titus", canonicalBook: "Tito", maxChapters: 3, aliases: ["tito", "titus"] },
  { volumeSlug: "nt", bookSlug: "philem", canonicalBook: "Filemone", maxChapters: 1, aliases: ["filemone", "philemon", "philem"] },
  { volumeSlug: "nt", bookSlug: "heb", canonicalBook: "Ebrei", maxChapters: 13, aliases: ["ebrei", "hebrews", "heb"] },
  { volumeSlug: "nt", bookSlug: "james", canonicalBook: "Giacomo", maxChapters: 5, aliases: ["giacomo", "james"] },
  { volumeSlug: "nt", bookSlug: "1-pet", canonicalBook: "1 Pietro", maxChapters: 5, aliases: ["1 pietro", "1 peter", "primo pietro", "first peter"] },
  { volumeSlug: "nt", bookSlug: "2-pet", canonicalBook: "2 Pietro", maxChapters: 3, aliases: ["2 pietro", "2 peter", "secondo pietro", "second peter"] },
  { volumeSlug: "nt", bookSlug: "1-jn", canonicalBook: "1 Giovanni", maxChapters: 5, aliases: ["1 giovanni", "1 john", "primo giovanni", "first john"] },
  { volumeSlug: "nt", bookSlug: "2-jn", canonicalBook: "2 Giovanni", maxChapters: 1, aliases: ["2 giovanni", "2 john", "secondo giovanni", "second john"] },
  { volumeSlug: "nt", bookSlug: "3-jn", canonicalBook: "3 Giovanni", maxChapters: 1, aliases: ["3 giovanni", "3 john", "terzo giovanni", "third john"] },
  { volumeSlug: "nt", bookSlug: "jude", canonicalBook: "Giuda", maxChapters: 1, aliases: ["giuda", "jude"] },
  { volumeSlug: "nt", bookSlug: "rev", canonicalBook: "Apocalisse", maxChapters: 22, aliases: ["apocalisse", "revelation", "rev"] },
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildUrl(
  volumeSlug: string,
  bookSlug: string,
  chapter: number,
  language: Language
): string {
  return `${CHURCH_SCRIPTURES_BASE}/${volumeSlug}/${bookSlug}/${chapter}?lang=${language}`;
}

function buildVerseHighlightId(verseStart: number, verseEnd?: number): string {
  const end = verseEnd ?? verseStart;
  return verseStart === end ? `p${verseStart}` : `p${verseStart}-p${end}`;
}

export function withVerseHighlight(
  url: string,
  verseStart: number,
  verseEnd?: number
): string {
  const verseId = buildVerseHighlightId(verseStart, verseEnd);
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("id", verseId);
    return parsed.toString();
  } catch {
    const hasQuery = url.includes("?");
    return `${url}${hasQuery ? "&" : "?"}id=${verseId}`;
  }
}

function toChapterList(start: number, end: number, maxChapters: number): number[] {
  const a = Math.max(1, Math.min(start, maxChapters));
  const b = Math.max(1, Math.min(end, maxChapters));
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: number[] = [];
  for (let c = lo; c <= hi; c += 1) out.push(c);
  return out;
}

function dedupeSorted(nums: number[]): number[] {
  return [...new Set(nums)].sort((a, b) => a - b);
}

function parseChapterExpression(rest: string, maxChapters: number): {
  chapters: number[];
  verseStart?: number;
  verseEnd?: number;
  hasVerse: boolean;
} {
  const cleaned = rest
    .replace(/^(capitolo|capitoli|chapter|chapters|cap)\s+/i, "")
    .trim();

  // Example: 2:1-8
  const verseRef = cleaned.match(/^(\d+)\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?/);
  if (verseRef) {
    const chapter = Number(verseRef[1]);
    const verseStart = Number(verseRef[2]);
    const verseEnd = verseRef[3] ? Number(verseRef[3]) : verseStart;
    return {
      chapters: toChapterList(chapter, chapter, maxChapters),
      verseStart,
      verseEnd,
      hasVerse: true,
    };
  }

  // Example: 2-5
  const rangeRef = cleaned.match(/^(\d+)\s*[-–]\s*(\d+)/);
  if (rangeRef) {
    return {
      chapters: toChapterList(Number(rangeRef[1]), Number(rangeRef[2]), maxChapters),
      hasVerse: false,
    };
  }

  // Example: 2, 3, 5
  const listRef = cleaned.match(/^(\d+(?:\s*,\s*\d+)+)/);
  if (listRef) {
    const chapters = listRef[1]
      .split(",")
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isInteger(n) && n > 0 && n <= maxChapters);
    return {
      chapters: dedupeSorted(chapters),
      hasVerse: false,
    };
  }

  // Example: 2
  const singleRef = cleaned.match(/^(\d+)/);
  if (singleRef) {
    const ch = Number(singleRef[1]);
    return {
      chapters: toChapterList(ch, ch, maxChapters),
      hasVerse: false,
    };
  }

  return { chapters: [], hasVerse: false };
}

function isWholeBookIntentForBook(query: string, canonicalBook: string): boolean {
  const normalized = normalize(query);
  const book = normalize(canonicalBook);
  const signals = [
    "intero",
    "tutto",
    "intera",
    "whole",
    "entire",
    "full book",
    "book of",
  ];
  return signals.some((s) => normalized.includes(s)) && normalized.includes(book);
}

export function parseScriptureSelection(
  query: string,
  language: Language
): ScriptureReferenceSelection | null {
  const normalized = normalize(query);

  for (const book of SCRIPTURE_BOOKS) {
    for (const alias of book.aliases) {
      const aliasPattern = escapeRegExp(normalize(alias));
      const aliasRx = new RegExp(`(?:^|\\s)${aliasPattern}(?=\\s|$)`);
      const m = normalized.match(aliasRx);
      if (!m || m.index === undefined) continue;

      const afterAlias = normalized.slice(m.index + m[0].length).trim();
      const parsed = parseChapterExpression(afterAlias, book.maxChapters);

      const wholeBook =
        parsed.chapters.length === 0 && isWholeBookIntentForBook(query, book.canonicalBook);
      const chapters = wholeBook
        ? toChapterList(1, book.maxChapters, book.maxChapters)
        : parsed.chapters;

      if (chapters.length === 0) {
        continue;
      }

      return {
        volumeSlug: book.volumeSlug,
        bookSlug: book.bookSlug,
        canonicalBook: book.canonicalBook,
        chapters,
        verseStart: parsed.verseStart,
        verseEnd: parsed.verseEnd,
        urls: chapters.map((chapter) => {
          const chapterUrl = buildUrl(book.volumeSlug, book.bookSlug, chapter, language);
          if (
            parsed.verseStart !== undefined &&
            chapter === chapters[0]
          ) {
            return withVerseHighlight(chapterUrl, parsed.verseStart, parsed.verseEnd);
          }
          return chapterUrl;
        }),
        wholeBook,
      };
    }
  }

  return null;
}

export function parseScriptureReference(
  query: string,
  language: Language
): ScriptureReference | null {
  const selection = parseScriptureSelection(query, language);
  if (!selection || selection.chapters.length === 0) return null;

  return {
    volumeSlug: selection.volumeSlug,
    bookSlug: selection.bookSlug,
    chapter: selection.chapters[0],
    verseStart: selection.verseStart,
    verseEnd: selection.verseEnd,
    canonicalBook: selection.canonicalBook,
    url: selection.urls[0],
  };
}

export function isWholeChapterIntent(query: string): boolean {
  const normalized = normalize(query);
  const chapterSignals = [
    "cosa insegna",
    "insegna",
    "insegnamenti",
    "cosa dice",
    "che cosa dice",
    "cosa possiamo imparare",
    "cosa impariamo",
    "lezione",
    "lezioni",
    "messaggio",
    "messaggio principale",
    "spunti",
    "principi",
    "cosa significa",
    "significato",
    "di cosa parla",
    "riassumi",
    "riassunto",
    "spiega",
    "spiegami",
    "teach",
    "teaches",
    "what does",
    "what do we learn",
    "what can we learn",
    "lessons",
    "main message",
    "key message",
    "principles",
    "insights",
    "explain",
    "explain what",
    "overview",
    "what is",
    "summary",
    "tema",
    "meaning",
  ];
  return chapterSignals.some((signal) => normalized.includes(signal));
}
