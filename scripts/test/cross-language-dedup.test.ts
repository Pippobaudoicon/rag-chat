/**
 * Regression test for cross-language de-duplication in the topical retrieval
 * path (`collapseCrossLanguage` in `src/lib/rag/retriever.ts`). Pure and
 * deterministic — no LLM/network.
 *
 * Run: `npm run test:cross-language`
 *
 * The bilingual index returns each passage in both corpus languages, so a
 * topical fan-out surfaced Exodus 18 (eng) AND Esodo 18 (ita) as two cards.
 * These asserts pin: cross-language pairs collapse to one, the answer-language
 * copy wins at the pair's best score, and single-language chunks pass through.
 */
import { collapseCrossLanguage } from "@/lib/rag/retriever";
import type { SourceChunk } from "@/lib/types";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

const chunk = (id: string, language: string, score: number): SourceChunk =>
  ({ id, language, score, source: "scriptures", text: "" }) as SourceChunk;

// Same verse in both languages (English scored higher, as in the report).
const enExodus = chunk("scriptures:eng:exodus:18:12-21:v1", "eng", 0.75);
const itaExodus = chunk("scriptures:ita:exodus:18:12-21:v1", "ita", 0.73);

const collapsed = collapseCrossLanguage([enExodus, itaExodus], "ita");
check("cross-language pair collapses to one", collapsed.length === 1, `got ${collapsed.length}`);
check("keeps the answer-language (ita) copy", collapsed[0]?.language === "ita");
check("keeps the pair's best score", collapsed[0]?.score === 0.75, `got ${collapsed[0]?.score}`);

// Answer language = eng → English copy wins instead.
const engPref = collapseCrossLanguage([itaExodus, enExodus], "eng");
check("answer-language eng keeps English copy", engPref[0]?.language === "eng" && engPref.length === 1);

// Different verse ranges are distinct passages, not a translation pair.
const enJacob15 = chunk("scriptures:eng:jacob:4:1-5:v1", "eng", 0.6);
const itaJacob13 = chunk("scriptures:ita:jacob:4:1-3:v1", "ita", 0.6);
const distinct = collapseCrossLanguage([enJacob15, itaJacob13], "ita");
check("different verse ranges both survive", distinct.length === 2, `got ${distinct.length}`);

// Only-English passage (no Italian partner) passes through unchanged.
const solo = collapseCrossLanguage([enJacob15], "ita");
check("single-language chunk passes through", solo.length === 1 && solo[0]?.language === "eng");

// Conference talks share the same id shape → same collapse applies.
const enTalk = chunk("conference:eng:2019:04:agency-and-choice:c1:v1", "eng", 0.8);
const itaTalk = chunk("conference:ita:2019:04:agency-and-choice:c1:v1", "ita", 0.7);
const talk = collapseCrossLanguage([enTalk, itaTalk], "ita");
check("conference cross-language pair collapses", talk.length === 1 && talk[0]?.language === "ita");

const total = 7;
console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
