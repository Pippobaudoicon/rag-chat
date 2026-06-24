import type { Language, SourceType } from "@/lib/types";

/**
 * Retrieval eval golden set.
 *
 * This is a SEED set with conservative, high-confidence expectations — grow it
 * over time as you find queries that matter. Two kinds of assertions:
 *
 *  - Structural (deterministic): `expectScriptureLanguage`, `expectSourcePresent`,
 *    `expectTitleAnyOf`, `expectSpeakerAnyOf`, `expectContentAnyOf`, `minResults`.
 *    These test plumbing (language preference, source filtering, expansion) and
 *    source-specific relevance, and should pass reliably.
 *  - Doctrinal (soft, recall-based): `expectRefsAnyOf` lists passages that *should*
 *    surface. Finding a subset still scores partial recall, so a single miss does
 *    not mean failure — it is a relevance signal to compare across tuning runs.
 *
 * Queries are written in the index language (English) since the chat route
 * translates before calling retrieval tools; the harness retrieves directly.
 */
export interface EvalCase {
  id: string;
  query: string;
  /** "scripture" mirrors lookup_scripture_passage (scriptures-only, generous
   * expansion); "semantic" mirrors semantic_search (multi-source, tight expansion). */
  kind: "scripture" | "semantic";
  sources?: SourceType[];
  language?: Language;
  topK?: number;
  /** Passages that should appear, e.g. "Alma 32", "2 Nephi 2", "John 3:16". Partial. */
  expectRefsAnyOf?: string[];
  /** The FIRST result must match one of these refs (book + optional verse) — the
   *  requested direct passage should rank first, not buried under related context. */
  expectFirstRefAnyOf?: string[];
  /** Source namespaces that should be present in the results. */
  expectSourcePresent?: SourceType[];
  /** Any result title should contain one of these strings. Partial, case-insensitive. */
  expectTitleAnyOf?: string[];
  /** Any result speaker should contain one of these strings. Partial, case-insensitive. */
  expectSpeakerAnyOf?: string[];
  /** Any result text/title/section/book should contain one of these strings. Partial, case-insensitive. */
  expectContentAnyOf?: string[];
  /** Every scripture chunk should be in this language (tests answer-language pref). */
  expectScriptureLanguage?: Language;
  /** Minimum number of results expected. */
  minResults?: number;
  /**
   * Mirror production language routing: translate `query` into the index
   * language (via routeQueryLanguage) before retrieving, instead of feeding the
   * raw foreign-language string to the pipeline. Use for cross-language cases so
   * the harness exercises the same English query the cross-encoder sees in prod.
   */
  routeQuery?: boolean;
}

export const EVAL_CASES: EvalCase[] = [
  // --- Scripture-reference lookups (book/chapter is high-confidence) ---
  {
    id: "scripture-alma-32",
    query: "Alma 32",
    kind: "scripture",
    expectRefsAnyOf: ["Alma 32"],
    expectScriptureLanguage: "eng",
    minResults: 1,
  },
  {
    id: "scripture-2nephi-2",
    query: "2 Nephi 2",
    kind: "scripture",
    expectRefsAnyOf: ["2 Nephi 2"],
    expectScriptureLanguage: "eng",
    minResults: 1,
  },
  {
    id: "scripture-moroni-10",
    query: "Moroni 10",
    kind: "scripture",
    expectRefsAnyOf: ["Moroni 10"],
    expectScriptureLanguage: "eng",
    minResults: 1,
  },
  {
    id: "scripture-john-3",
    query: "John 3",
    kind: "scripture",
    expectRefsAnyOf: ["John 3"],
    expectFirstRefAnyOf: ["John 3"],
    expectScriptureLanguage: "eng",
    minResults: 1,
  },
  // --- Direct-passage language preference + ranking (tool-specific language
  // routing). The requested book/passage must rank FIRST and direct-passage
  // chunks must be in the prompt's scripture language: Giovanni → Italian, John →
  // English. The single-language related filter keeps cross-references in the
  // same language (related_ids are English-only in the graph). ---
  {
    id: "scripture-john-3-16",
    query: "John 3:16",
    kind: "scripture",
    language: "eng",
    expectRefsAnyOf: ["John 3:16"],
    expectFirstRefAnyOf: ["John 3:16", "John 3"],
    expectScriptureLanguage: "eng",
    minResults: 1,
  },
  {
    id: "scripture-giovanni-3",
    query: "Giovanni 3",
    kind: "scripture",
    language: "ita",
    expectRefsAnyOf: ["Giovanni 3"],
    expectFirstRefAnyOf: ["Giovanni 3"],
    expectScriptureLanguage: "ita",
    minResults: 1,
  },
  {
    id: "scripture-giovanni-3-16",
    query: "Giovanni 3:16",
    kind: "scripture",
    language: "ita",
    expectRefsAnyOf: ["Giovanni 3:16"],
    expectFirstRefAnyOf: ["Giovanni 3:16", "Giovanni 3"],
    expectScriptureLanguage: "ita",
    minResults: 1,
  },
  {
    id: "scripture-psalms-23",
    query: "Psalms 23",
    kind: "scripture",
    expectRefsAnyOf: ["Psalms 23"],
    expectScriptureLanguage: "eng",
    minResults: 1,
  },
  {
    id: "scripture-1nephi-3",
    query: "1 Nephi 3",
    kind: "scripture",
    expectRefsAnyOf: ["1 Nephi 3"],
    expectScriptureLanguage: "eng",
    minResults: 1,
  },
  {
    id: "scripture-mosiah-3-19",
    query: "Mosiah 3:19",
    kind: "scripture",
    expectRefsAnyOf: ["Mosiah 3:19"],
    expectScriptureLanguage: "eng",
    minResults: 1,
  },
  {
    id: "scripture-3nephi-11",
    query: "3 Nephi 11",
    kind: "scripture",
    expectRefsAnyOf: ["3 Nephi 11"],
    expectScriptureLanguage: "eng",
    minResults: 1,
  },
  {
    id: "scripture-dc-121",
    query: "Doctrine and Covenants 121",
    kind: "scripture",
    expectRefsAnyOf: ["Doctrine and Covenants 121"],
    expectScriptureLanguage: "eng",
    minResults: 1,
  },
  {
    id: "scripture-dc-89",
    query: "Doctrine and Covenants 89",
    kind: "scripture",
    expectRefsAnyOf: ["Doctrine and Covenants 89"],
    expectScriptureLanguage: "eng",
    minResults: 1,
  },
  {
    id: "scripture-italian-2nefi-2",
    query: "2 Nefi 2",
    kind: "scripture",
    language: "ita",
    expectRefsAnyOf: ["2 Nefi 2"],
    expectScriptureLanguage: "ita",
    minResults: 1,
  },
  {
    id: "scripture-italian-moroni-10",
    query: "Moroni 10",
    kind: "scripture",
    language: "ita",
    expectRefsAnyOf: ["Moroni 10"],
    expectScriptureLanguage: "ita",
    minResults: 1,
  },

  // --- Topical / doctrinal (soft recall over likely-central passages) ---
  {
    id: "topic-faith",
    query: "What does the Book of Mormon teach about faith?",
    kind: "semantic",
    expectRefsAnyOf: ["Alma 32", "Ether 12", "Moroni 7"],
    expectScriptureLanguage: "eng",
    minResults: 3,
  },
  {
    id: "topic-atonement",
    query: "Explain the Atonement of Jesus Christ",
    kind: "semantic",
    expectRefsAnyOf: ["Alma 7", "Mosiah 3", "2 Nephi 9", "Alma 34"],
    minResults: 3,
  },
  {
    id: "topic-repentance",
    query: "How can I repent of my sins?",
    kind: "semantic",
    expectRefsAnyOf: ["Mosiah 4", "Alma 34", "Alma 36"],
    minResults: 3,
  },
  {
    id: "topic-baptism",
    query: "Why is baptism necessary?",
    kind: "semantic",
    expectRefsAnyOf: ["2 Nephi 31", "Mosiah 18", "John 3"],
    minResults: 3,
  },
  {
    id: "topic-prayer",
    query: "What do the scriptures teach about prayer?",
    kind: "semantic",
    expectRefsAnyOf: ["3 Nephi 18", "Alma 34", "Matthew 6"],
    minResults: 3,
  },
  {
    id: "topic-sacrament",
    query: "What is the purpose of the sacrament in the Church?",
    kind: "semantic",
    expectRefsAnyOf: ["3 Nephi 18", "Moroni 4", "Moroni 5", "Doctrine and Covenants 20:77"],
    minResults: 3,
  },
  {
    // Ref-free phrasing on purpose: an explicit "Mosiah 3:19" in the query makes
    // retrieve() short-circuit to a scripture lookup. This tests real multi-source
    // semantic recall of the passage instead.
    id: "topic-natural-man",
    query: "What do the scriptures teach about putting off the natural man and becoming a saint?",
    kind: "semantic",
    expectRefsAnyOf: ["Mosiah 3:19"],
    minResults: 3,
  },
  {
    id: "topic-charity",
    query: "What does the Book of Mormon teach about charity?",
    kind: "semantic",
    expectRefsAnyOf: ["Moroni 7:45", "Moroni 7:47", "1 Corinthians 13"],
    minResults: 3,
  },
  {
    id: "topic-holy-ghost",
    query: "How can I recognize the Holy Ghost?",
    kind: "semantic",
    expectRefsAnyOf: ["Moroni 10", "Galatians 5", "Doctrine and Covenants 8", "Doctrine and Covenants 9"],
    minResults: 3,
  },
  {
    // Ref-free phrasing on purpose (see topic-natural-man): exercises genuine
    // multi-source semantic recall rather than the scripture-lookup short-circuit.
    id: "topic-leadership",
    query: "What do the scriptures teach about righteous leadership and avoiding unrighteous dominion?",
    kind: "semantic",
    expectRefsAnyOf: ["Doctrine and Covenants 121:41", "Doctrine and Covenants 121:42", "Doctrine and Covenants 121:43"],
    minResults: 3,
  },
  {
    id: "topic-worth-of-souls",
    query: "What do the scriptures teach about the worth of souls?",
    kind: "semantic",
    expectRefsAnyOf: ["Doctrine and Covenants 18:10", "Doctrine and Covenants 18:15", "Moses 1:39"],
    minResults: 3,
  },
  {
    id: "topic-word-of-wisdom",
    query: "What is the Word of Wisdom?",
    kind: "semantic",
    expectRefsAnyOf: ["Doctrine and Covenants 89"],
    minResults: 3,
  },
  {
    id: "topic-plan-of-salvation",
    query: "What is the plan of salvation?",
    kind: "semantic",
    expectRefsAnyOf: ["2 Nephi 2", "Alma 40", "Moses 1:39"],
    minResults: 3,
  },
  {
    id: "topic-trials",
    query: "What sources teach about faith during trials?",
    kind: "semantic",
    expectRefsAnyOf: ["Ether 12", "1 Peter 1", "Romans 5"],
    minResults: 3,
  },
  {
    id: "topic-family-prayer",
    query: "Find teachings about family prayer",
    kind: "semantic",
    expectRefsAnyOf: ["3 Nephi 18", "Alma 34"],
    minResults: 3,
  },
  {
    id: "topic-jesus-healer",
    query: "Find sources about Jesus Christ as Healer",
    kind: "semantic",
    expectRefsAnyOf: ["Matthew 8", "3 Nephi 17", "Alma 7"],
    minResults: 3,
  },
  {
    id: "topic-light",
    query: "Teach me about light in the scriptures",
    kind: "semantic",
    expectRefsAnyOf: ["Doctrine and Covenants 88", "John 8", "3 Nephi 18"],
    minResults: 3,
  },

  // --- Structural: study-helps presence + source filtering ---
  {
    id: "studyhelps-faith",
    query: "faith definition and meaning",
    kind: "semantic",
    sources: ["study_helps"],
    expectSourcePresent: ["study_helps"],
    minResults: 1,
  },
  {
    id: "studyhelps-repentance",
    query: "repentance definition Guide to the Scriptures",
    kind: "semantic",
    sources: ["study_helps"],
    expectSourcePresent: ["study_helps"],
    expectContentAnyOf: ["repentance", "repent"],
    minResults: 1,
  },
  {
    id: "handbook-temple-recommend",
    query: "temple recommend worthiness questions",
    kind: "semantic",
    sources: ["handbook"],
    expectSourcePresent: ["handbook"],
    minResults: 1,
  },
  {
    id: "handbook-bishop-duties",
    query: "What does the General Handbook say about the bishop's duties?",
    kind: "semantic",
    sources: ["handbook"],
    expectSourcePresent: ["handbook"],
    expectContentAnyOf: ["bishop"],
    minResults: 1,
  },
  {
    id: "handbook-ward-council",
    query: "What is the role of the ward council according to the General Handbook?",
    kind: "semantic",
    sources: ["handbook"],
    expectSourcePresent: ["handbook"],
    expectContentAnyOf: ["ward council"],
    minResults: 1,
  },
  {
    id: "handbook-ministering",
    query: "ministering brothers and sisters responsibilities",
    kind: "semantic",
    sources: ["handbook"],
    expectSourcePresent: ["handbook"],
    expectContentAnyOf: ["ministering"],
    minResults: 1,
  },
  {
    id: "conference-think-celestial",
    query: "President Nelson Think Celestial",
    kind: "semantic",
    sources: ["conference"],
    expectSourcePresent: ["conference"],
    expectTitleAnyOf: ["Think Celestial"],
    expectSpeakerAnyOf: ["Russell M. Nelson"],
    minResults: 1,
  },
  {
    id: "conference-peacemakers",
    query: "President Nelson peacemakers needed",
    kind: "semantic",
    sources: ["conference"],
    expectSourcePresent: ["conference"],
    expectTitleAnyOf: ["Peacemakers Needed"],
    expectSpeakerAnyOf: ["Russell M. Nelson"],
    minResults: 1,
  },
  {
    id: "conference-laborers-vineyard",
    query: "President Eyring laborers in the vineyard",
    kind: "semantic",
    sources: ["conference"],
    expectSourcePresent: ["conference"],
    expectTitleAnyOf: ["You Are Not Alone in the Work"],
    expectSpeakerAnyOf: ["Henry B. Eyring"],
    expectContentAnyOf: ["laborers in the vineyard"],
    minResults: 1,
  },
  {
    id: "gospel-topics-tithing",
    query: "tithing Gospel Topics",
    kind: "semantic",
    sources: ["gospel_topics"],
    expectSourcePresent: ["gospel_topics"],
    expectContentAnyOf: ["tithing"],
    minResults: 1,
  },
  {
    id: "gospel-topics-mother-in-heaven",
    query: "Mother in Heaven Gospel Topics essay",
    kind: "semantic",
    sources: ["gospel_topics"],
    expectSourcePresent: ["gospel_topics"],
    expectContentAnyOf: ["mother in heaven", "heavenly mother"],
    minResults: 1,
  },
  {
    id: "gospel-topics-race-priesthood",
    query: "Race and the Priesthood Gospel Topics essay",
    kind: "semantic",
    sources: ["gospel_topics"],
    expectSourcePresent: ["gospel_topics"],
    expectContentAnyOf: ["race", "priesthood"],
    minResults: 1,
  },
  {
    id: "gospel-study-scripture-study",
    query: "How can I study the scriptures more effectively?",
    kind: "semantic",
    sources: ["gospel_study"],
    expectSourcePresent: ["gospel_study"],
    expectContentAnyOf: ["scripture study", "study the scriptures", "scriptures"],
    minResults: 1,
  },
  {
    id: "gospel-selfreliance-emotional-resilience",
    query: "emotional resilience in the Lord",
    kind: "semantic",
    sources: ["gospel_selfreliance"],
    expectSourcePresent: ["gospel_selfreliance"],
    expectContentAnyOf: ["emotional resilience", "resilience"],
    minResults: 1,
  },

  // --- Cross-language (Italian) topical: an Italian user prompt. `routeQuery`
  // mirrors production — the prompt is translated into the index language before
  // retrieval, so the cross-encoder sees the same English query it does in prod
  // (not the raw Italian string). No expectScriptureLanguage: the semantic
  // fan-out returns both indexed languages, and "Alma" is identical in Italian,
  // so the ref match holds either way. ---
  {
    id: "italian-topic-faith",
    query: "Cosa insegnano le Scritture sulla fede?",
    kind: "semantic",
    routeQuery: true,
    expectRefsAnyOf: ["Alma 32"],
    minResults: 3,
  },
  {
    id: "italian-topic-repentance",
    query: "Come posso pentirmi dei miei peccati?",
    kind: "semantic",
    routeQuery: true,
    expectRefsAnyOf: ["Alma 34", "Alma 36"],
    minResults: 3,
  },
];
