/**
 * Regression tests for the P1 eager-retrieval eligibility gate
 * (`src/app/api/chat/route.ts`, section 5b). Pure and deterministic — no
 * LLM/network — so it guards the gate without the eval harness's cost.
 *
 * Run: `npm run test:eager`
 *
 * Eager retrieval uses a conservative positive allowlist (false negatives
 * preferred over false positives). It runs ONLY for genuine topical questions;
 * it is skipped for:
 *   - scripture references  → `parseScriptureSelection` non-null (route gate)
 *   - chit-chat / greetings / acknowledgements    → `isEagerTopicalQuery` false
 *   - response-edit / conversational follow-ups   → `isEagerTopicalQuery` false
 *   - specific conference-talk requests           → `isEagerTopicalQuery` false
 *   - too-short prompts                           → `isEagerTopicalQuery` false
 *
 * The classifier sees the English-translated `languageRouting.searchQuery` (the
 * route only runs eager on the English index), so the Italian-origin cases below
 * are written as the English search query routing produces for an Italian prompt
 * — that is exactly the string the classifier receives in production.
 *
 * We assert each category here, plus that the eager user message carries the
 * preloaded-context contract (so the model does not re-emit semantic_search).
 */
import { parseScriptureSelection } from "@/lib/rag/scripture-reference";
import { isEagerTopicalQuery } from "@/lib/rag/eager-eligibility";
import { buildUserMessage } from "@/lib/rag/system-prompt";
import type { Language, SourceChunk } from "@/lib/types";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

// ── Scripture skip (route uses parseScriptureSelection on the search query) ───
type ScriptureCase = { label: string; query: string; language: Language; isScripture: boolean };
const scriptureCases: ScriptureCase[] = [
  { label: "verse reference", query: "Alma 32:21", language: "eng", isScripture: true },
  { label: "verse range", query: "Alma 32:21-23", language: "eng", isScripture: true },
  { label: "chapter reference", query: "3 Nephi 11", language: "eng", isScripture: true },
  { label: "Italian verse reference", query: "Alma 32:21", language: "ita", isScripture: true },
  { label: "topical is not scripture", query: "What does faith mean?", language: "eng", isScripture: false },
];
for (const c of scriptureCases) {
  const got = parseScriptureSelection(c.query, c.language) !== null;
  check(`scripture: ${c.label}`, got === c.isScripture, `expected ${c.isScripture}, got ${got}`);
}

// ── Topical allowlist (isEagerTopicalQuery, on the English search query) ──────
type TopicalCase = { label: string; query: string; eligible: boolean };
const topicalCases: TopicalCase[] = [
  // Eligible — genuine topical / doctrinal questions.
  { label: "faith question", query: "What does it mean that faith is not a perfect knowledge?", eligible: true },
  { label: "repentance question", query: "How do I repent of my sins?", eligible: true },
  { label: "short doctrinal question", query: "What is faith?", eligible: true },
  { label: "consecration question", query: "Explain the law of consecration", eligible: true },
  // Skip — chit-chat / acknowledgements.
  { label: "thanks", query: "thanks", eligible: false },
  { label: "thank you phrase", query: "Thank you so much", eligible: false },
  { label: "greeting", query: "Hi there", eligible: false },
  { label: "ok", query: "ok", eligible: false },
  // Skip — response-edit / conversational follow-ups.
  { label: "make that shorter", query: "make that shorter", eligible: false },
  { label: "shorten that", query: "shorten that", eligible: false },
  { label: "translate request", query: "translate that to Italian", eligible: false },
  { label: "continue", query: "continue", eligible: false },
  { label: "in italian please", query: "in Italian please", eligible: false },
  // Skip — specific conference-talk requests.
  { label: "talk by speaker", query: "Summarize the talk by Uchtdorf about grace", eligible: false },
  { label: "general conference", query: "What was said in general conference about service?", eligible: false },
  // Skip — too short.
  { label: "two words", query: "define charity", eligible: false },
  // Guard — 'talk about <topic>' is topical, NOT a talk reference.
  { label: "talk about phrasing stays eligible", query: "Can we talk about the plan of salvation?", eligible: true },

  // Italian-origin turns — classified via the English `searchQuery` routing
  // produces (the route only runs eager on the English index).
  // "Cosa insegna il Vangelo riguardo all'umiltà?"
  { label: "[it→en] topical question", query: "What does the gospel teach about humility?", eligible: true },
  // "Grazie mille"
  { label: "[it→en] acknowledgement", query: "Thank you very much", eligible: false },
  // "Rendilo più breve"
  { label: "[it→en] response-edit follow-up", query: "Make it shorter", eligible: false },
  // "Riassumi il discorso di Uchtdorf sulla grazia"
  { label: "[it→en] conference-talk request", query: "Summarize the talk by Uchtdorf about grace", eligible: false },
];
for (const c of topicalCases) {
  const got = isEagerTopicalQuery(c.query);
  check(`topical: ${c.label}`, got === c.eligible, `expected ${c.eligible}, got ${got}`);
}

// ── Prompt contract: eager context tells the model retrieval already ran ──────
const routing = {
  uiLanguage: "eng" as const,
  inputLanguageCode: "en",
  inputLanguageName: "English",
  indexLanguage: "eng" as const,
  indexLanguageName: "English",
  searchQuery: "what is faith",
};
const chunk: SourceChunk = {
  id: "x1",
  text: "Faith is the substance of things hoped for.",
  source: "scriptures",
  title: "Alma 32",
} as SourceChunk;

const eagerMsg = buildUserMessage("What is faith?", [chunk], routing, "eager");
check(
  "eager message carries preloaded-context contract",
  eagerMsg.includes("preloaded semantic search") && /do NOT call semantic_search again/i.test(eagerMsg)
);
check("eager message still embeds the chunk", eagerMsg.includes("[Source 1]"));

const fixedMsg = buildUserMessage("What is faith?", [chunk], routing, "fixed");
check("fixed message does NOT use the eager contract", !fixedMsg.includes("preloaded semantic search"));

const toolFirstMsg = buildUserMessage("What is faith?", [], routing);
check("empty-context message has no Context block", !toolFirstMsg.includes("[Source 1]"));

const total =
  scriptureCases.length + topicalCases.length + 4; // + 4 contract assertions
console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
