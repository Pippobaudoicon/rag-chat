/**
 * Regression tests for the local same-language fast-path decision
 * (`detectIndexLanguageMatch`). Pure and deterministic — no LLM/network — so it
 * guards the routing short-circuit without the eval harness's cost.
 *
 * Run: `npm run test:routing`
 *
 * Focus: a prompt is only short-circuited when it is confidently, dominantly in
 * the index language. Mixed/quoted-language prompts (an instruction in one
 * language over a quote/question in another) MUST fall through to the LLM
 * translation path, or we'd tell the model to answer in the wrong language and
 * search with an untranslated query (codex review on PR #7).
 */
import { detectIndexLanguageMatch } from "@/lib/rag/language-routing";
import type { CorpusLanguage } from "@/lib/types";

type Case = {
  label: string;
  query: string;
  indexLanguage: CorpusLanguage;
  // Expected fast-path code (e.g. "en") to short-circuit, or null to use the LLM.
  expect: string | null;
};

const cases: Case[] = [
  // Pure index-language → short-circuit.
  {
    label: "pure English question",
    query: "What does it mean that faith is not to have a perfect knowledge of things?",
    indexLanguage: "eng",
    expect: "en",
  },
  { label: "short English question", query: "How do I repent of my sins?", indexLanguage: "eng", expect: "en" },
  // Cross-language → must translate via LLM.
  {
    label: "pure Italian question (→ English index)",
    query: "Che cosa insegna il Libro di Mormon riguardo al pentimento?",
    indexLanguage: "eng",
    expect: null,
  },
  { label: "pure Spanish question (→ English index)", query: "¿Qué es la fe en Jesucristo?", indexLanguage: "eng", expect: null },
  // Mixed/quoted-language → must NOT short-circuit (the codex regression).
  {
    label: "Italian instruction over an English question",
    query:
      "Rispondi in italiano: What does it mean that faith is not to have a perfect knowledge of things?",
    indexLanguage: "eng",
    expect: null,
  },
  {
    label: "Spanish instruction over an English question",
    query: "Responde en español: What does it mean that faith is a principle of action?",
    indexLanguage: "eng",
    expect: null,
  },
  {
    label: "Italian question quoting a long English passage",
    query:
      'Cosa significa questo versetto: "faith is not to have a perfect knowledge of things, therefore if ye have faith ye hope for things which are not seen, which are true"?',
    indexLanguage: "eng",
    expect: null,
  },
  // Too short/ambiguous → LLM fallback (don't guess).
  { label: "bare scripture reference", query: "Alma 32:21", indexLanguage: "eng", expect: null },
  // Italian index variant: pure Italian short-circuits there.
  {
    label: "pure Italian question (→ Italian index)",
    query: "Che cosa insegna il Libro di Mormon riguardo al pentimento?",
    indexLanguage: "ita",
    expect: "it",
  },
];

let failures = 0;
for (const c of cases) {
  const got = detectIndexLanguageMatch(c.query, c.indexLanguage);
  const ok = got === c.expect;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.label}  (expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)})`);
}

console.log(`\n${cases.length - failures}/${cases.length} passed`);
if (failures > 0) process.exit(1);
