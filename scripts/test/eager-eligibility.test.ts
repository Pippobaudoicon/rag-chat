/**
 * Regression tests for the P1 eager-retrieval scripture-skip gate
 * (`src/app/api/chat/route.ts`, section 5b). Pure and deterministic — no
 * LLM/network — so it guards the gate without the eval harness's cost.
 *
 * Run: `npm run test:eager`
 *
 * The route runs eager semantic_search only when the query is NOT a scripture
 * reference (those go through `lookup_scripture_passage`, not semantic_search).
 * The skip decision is exactly `parseScriptureSelection(query, language) !== null`,
 * so we assert that classification here: scripture refs → non-null (skip eager),
 * topical questions → null (eager eligible).
 */
import { parseScriptureSelection } from "@/lib/rag/scripture-reference";
import type { Language } from "@/lib/types";

type Case = {
  label: string;
  query: string;
  language: Language;
  // true → parseScriptureSelection should be non-null → eager is SKIPPED.
  expectScripture: boolean;
};

const cases: Case[] = [
  // Scripture references → skip eager (lookup_scripture_passage handles these).
  { label: "verse reference", query: "Alma 32:21", language: "eng", expectScripture: true },
  { label: "verse range", query: "Alma 32:21-23", language: "eng", expectScripture: true },
  { label: "chapter reference", query: "3 Nephi 11", language: "eng", expectScripture: true },
  { label: "Italian verse reference", query: "Alma 32:21", language: "ita", expectScripture: true },
  // Topical questions → eager eligible.
  {
    label: "topical faith question",
    query: "What does it mean that faith is not to have a perfect knowledge of things?",
    language: "eng",
    expectScripture: false,
  },
  { label: "topical repentance question", query: "How do I repent of my sins?", language: "eng", expectScripture: false },
  {
    label: "Italian topical question",
    query: "Che cosa insegna il Libro di Mormon riguardo al pentimento?",
    language: "ita",
    expectScripture: false,
  },
];

let failures = 0;
for (const c of cases) {
  const isScripture = parseScriptureSelection(c.query, c.language) !== null;
  const ok = isScripture === c.expectScripture;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${c.label}  (expected scripture=${c.expectScripture}, got ${isScripture})`
  );
}

console.log(`\n${cases.length - failures}/${cases.length} passed`);
if (failures > 0) process.exit(1);
