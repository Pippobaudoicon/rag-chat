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

// Source-cap sharing: a slower specific lookup and a faster semantic_search in
// the same round split the cap round-robin, lookup first; neither is starved.
async function priorityCheck() {
  const ctx = createRagToolContext({ maxChunks: 4 });
  const passage = ["21", "22", "23"].map((v) => chunk(`scriptures:ita:alma:32:${v}:v1`, "ita", 0.9));
  const topical = ["a", "b", "c"].map((id) => ({ ...conference, id: `conference:eng:${id}` }));
  const indices = (claimed: { citationIndex: number }[]) => claimed.map((c) => c.citationIndex).join();
  const [lookupIdx, semanticIdx] = await Promise.all([
    ctx.trackCall(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return indices(await ctx.claimChunks(passage, 0));
    }),
    ctx.trackCall(async () => indices(await ctx.claimChunks(topical, 2))),
  ]);
  check(
    "parallel calls share the cap: lookup first, semantic_search not starved",
    lookupIdx === "1,2" && semanticIdx === "3,4",
    `lookup=${lookupIdx} semantic=${semanticIdx}`
  );
}

priorityCheck().then(() => {
  const total = 5;
  console.log(`\n${total - failures}/${total} passed`);
  if (failures > 0) process.exit(1);
});
