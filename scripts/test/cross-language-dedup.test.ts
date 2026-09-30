/**
 * Scripture-language guarantees in the topical retrieval path:
 * `filterScripturesByLanguage` (`src/lib/rag/retriever.ts`) and the per-turn
 * scripture-language lock (`createRagToolContext`). Pure and deterministic — no
 * LLM/network.
 *
 * Run: `pnpm run test:cross-language`
 *
 * Scriptures are the only bilingual namespace, and the semantic fan-out queries
 * them in one language, so a turn never holds an English/Italian pair of the same
 * passage. These asserts pin the guards that keep it that way: the opposite-language
 * scripture is removed, other sources pass through, and the first tool's language
 * choice locks every later tool.
 */
import { filterScripturesByLanguage } from "@/lib/rag/retriever";
import { createRagToolContext } from "@/lib/rag/tools/shared/tool-context";
import type { SourceChunk } from "@/lib/types";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

const chunk = (id: string, language: string, score: number): SourceChunk =>
  ({ id, language, score, source: "scriptures", text: "" }) as SourceChunk;

// Same verse in both languages.
const enExodus = chunk("scriptures:eng:exodus:18:12-21:v1", "eng", 0.75);
const itaExodus = chunk("scriptures:ita:exodus:18:12-21:v1", "ita", 0.73);
const conference = {
  ...chunk("conference:eng:2019:04:agency-and-choice:c1:v1", "eng", 0.8),
  source: "conference" as const,
};

const italianOnly = filterScripturesByLanguage(
  [enExodus, itaExodus, conference],
  "ita"
);
check(
  "Italian prompt removes every English scripture",
  italianOnly.length === 2 &&
    italianOnly.some((item) => item.id === itaExodus.id) &&
    italianOnly.some((item) => item.source === "conference")
);

const englishOnly = filterScripturesByLanguage(
  [enExodus, itaExodus, conference],
  "eng"
);
check(
  "English prompt removes every Italian scripture",
  englishOnly.length === 2 &&
    englishOnly.some((item) => item.id === enExodus.id) &&
    englishOnly.some((item) => item.source === "conference")
);

const languageLock = createRagToolContext();
check(
  "first tool locks scripture language for the turn",
  languageLock.resolveScriptureLanguage("ita") === "ita" &&
    languageLock.resolveScriptureLanguage("eng") === "ita"
);

const initialLanguageLock = createRagToolContext({
  initialChunks: [enExodus],
});
check(
  "preloaded scriptures lock later tools to their language",
  initialLanguageLock.resolveScriptureLanguage("ita") === "eng"
);

const total = 4;
console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
