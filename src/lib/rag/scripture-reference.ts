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
  {
    volumeSlug: "bofm",
    bookSlug: "1-ne",
    canonicalBook: "1 Nefi",
    maxChapters: 22,
    aliases: ["1 nefi", "1 nephi", "primo nefi", "first nephi"],
  },
  {
    volumeSlug: "bofm",
    bookSlug: "2-ne",
    canonicalBook: "2 Nefi",
    maxChapters: 33,
    aliases: ["2 nefi", "2 nephi", "secondo nefi", "second nephi"],
  },
  {
    volumeSlug: "bofm",
    bookSlug: "jacob",
    canonicalBook: "Giacobbe",
    maxChapters: 7,
    aliases: ["giacobbe", "jacob"],
  },
  {
    volumeSlug: "bofm",
    bookSlug: "enos",
    canonicalBook: "Enos",
    maxChapters: 1,
    aliases: ["enos"],
  },
  {
    volumeSlug: "bofm",
    bookSlug: "jarom",
    canonicalBook: "Jarom",
    maxChapters: 1,
    aliases: ["jarom"],
  },
  {
    volumeSlug: "bofm",
    bookSlug: "omni",
    canonicalBook: "Omni",
    maxChapters: 1,
    aliases: ["omni"],
  },
  {
    volumeSlug: "bofm",
    bookSlug: "w-of-m",
    canonicalBook: "Parole di Mormon",
    maxChapters: 1,
    aliases: [
      "parole di mormon",
      "parole mormon",
      "words of mormon",
      "w of m",
    ],
  },
  {
    volumeSlug: "bofm",
    bookSlug: "mosiah",
    canonicalBook: "Mosia",
    maxChapters: 29,
    aliases: ["mosia", "mosiah"],
  },
  {
    volumeSlug: "bofm",
    bookSlug: "alma",
    canonicalBook: "Alma",
    maxChapters: 63,
    aliases: ["alma"],
  },
  {
    volumeSlug: "bofm",
    bookSlug: "hel",
    canonicalBook: "Helaman",
    maxChapters: 16,
    aliases: ["helaman", "hel"],
  },
  {
    volumeSlug: "bofm",
    bookSlug: "3-ne",
    canonicalBook: "3 Nefi",
    maxChapters: 30,
    aliases: ["3 nefi", "3 nephi", "terzo nefi", "third nephi"],
  },
  {
    volumeSlug: "bofm",
    bookSlug: "4-ne",
    canonicalBook: "4 Nefi",
    maxChapters: 1,
    aliases: ["4 nefi", "4 nephi", "quarto nefi", "fourth nephi"],
  },
  {
    volumeSlug: "bofm",
    bookSlug: "morm",
    canonicalBook: "Mormon",
    maxChapters: 9,
    aliases: ["mormon"],
  },
  {
    volumeSlug: "bofm",
    bookSlug: "ether",
    canonicalBook: "Ether",
    maxChapters: 15,
    aliases: ["ether", "etere"],
  },
  {
    volumeSlug: "bofm",
    bookSlug: "moro",
    canonicalBook: "Moroni",
    maxChapters: 10,
    aliases: ["moroni", "moro"],
  },
  {
    volumeSlug: "dc-testament",
    bookSlug: "dc",
    canonicalBook: "Dottrina e Alleanze",
    maxChapters: 138,
    aliases: [
      "dottrina e alleanze",
      "dottrina alleanze",
      "dottrina & alleanze",
      "d&a",
      "da",
      "d c",
      "dc",
      "doctrine and covenants",
      "d&c",
    ],
  },
  {
    volumeSlug: "pgp",
    bookSlug: "moses",
    canonicalBook: "Mosè",
    maxChapters: 8,
    aliases: ["mose", "mosè", "moses"],
  },
  {
    volumeSlug: "pgp",
    bookSlug: "abr",
    canonicalBook: "Abrahamo",
    maxChapters: 5,
    aliases: ["abrahamo", "abraham"],
  },
  {
    volumeSlug: "pgp",
    bookSlug: "js-m",
    canonicalBook: "Joseph Smith-Matteo",
    maxChapters: 1,
    aliases: ["joseph smith matteo", "joseph smith matthew", "js-m", "js m"],
  },
  {
    volumeSlug: "pgp",
    bookSlug: "js-h",
    canonicalBook: "Joseph Smith-Storia",
    maxChapters: 1,
    aliases: ["joseph smith storia", "joseph smith history", "js-h", "js h"],
  },
  {
    volumeSlug: "pgp",
    bookSlug: "a-of-f",
    canonicalBook: "Articoli di Fede",
    maxChapters: 1,
    aliases: ["articoli di fede", "articles of faith", "a of f"],
  },
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
        urls: chapters.map((chapter) =>
          buildUrl(book.volumeSlug, book.bookSlug, chapter, language)
        ),
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
