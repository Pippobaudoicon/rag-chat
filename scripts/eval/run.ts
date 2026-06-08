/**
 * Retrieval eval harness.
 *
 * Runs each golden case through the real retrieval pipeline (the same shared
 * helpers the tools use), then reports relevance metrics with the cross-encoder
 * reranker (RAG_RERANK / Voyage rerank-2.5) OFF vs ON, head-to-head. The harness
 * forces both arms itself (independent of the RAG_RERANK env value). Graph rerank
 * is held CONSTANT across both arms (per its own env flag), so it is not the
 * variable here.
 *
 * CAVEAT — clean isolation requires multi-query OFF: the two arms run separate
 * retrievals, so with RAG_MULTI_QUERY=on each arm's LLM generates its OWN (non-
 * deterministic) query variants and the candidate sets differ — the off→on
 * columns then conflate reranking with pool differences. Measure the reranker
 * with multi-query off (the default). RAG_MULTI_QUERY / RAG_MMR are themselves
 * measured the right way regardless: run twice toggling the env flag and compare
 * the SAME arm's aggregate across the two runs (not the off→on columns).
 *
 * Usage:
 *   npm run eval               # all cases
 *   npm run eval -- faith      # only cases whose id/query contains "faith"
 *   RAG_MULTI_QUERY=on npm run eval   # measure multi-query expansion vs a plain run
 *
 * Requires the same env as the app (PINECONE_*, VOYAGE_*, RAG_INDEX_LANGUAGE).
 * The npm script injects .env / .env.local. NOTE: the off→on arms issue two
 * retrieval calls per case, so reranker A/B costs two embeds per case.
 */
import { retrieve } from "@/lib/rag/retriever";
import { expandRelatedContext } from "@/lib/rag/tools/shared/related-context";
import { graphRerank } from "@/lib/rag/tools/shared/graph-rerank";
import { normalizeBookForStrictMatch, normalizeForMatch } from "@/lib/rag/tools/shared/text-normalize";
import {
  isGraphRerankEnabled,
  isDiversityEnabled,
  isMultiQueryEnabled,
} from "@/lib/rag/flags";
import { DEFAULT_SOURCES } from "@/lib/types";
import type { Language, SourceChunk } from "@/lib/types";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVAL_CASES, type EvalCase } from "./dataset";

// Mirror the per-tool expansion caps so the eval reflects production behavior.
const SEMANTIC_FROM_TOP_N = 4;
const SEMANTIC_RELATED_CAP = 8;
const SCRIPTURE_RELATED_CAP = 24;
const DEFAULT_TOPK = 12;

interface ParsedRef {
  book: string; // normalized
  chapter?: number;
  verse?: string;
}

function parseRef(ref: string): ParsedRef {
  const m = ref.trim().match(/^(.*?)(\d+)(?::(\d+(?:-\d+)?))?\s*$/);
  if (m && m[1].trim()) {
    return {
      book: normalizeBookForStrictMatch(m[1]),
      chapter: Number(m[2]),
      verse: m[3],
    };
  }
  return { book: normalizeBookForStrictMatch(ref) };
}

function parseVerseRange(value: string): { start: number; end: number } | null {
  const m = value.match(/(\d+)(?:-(\d+))?/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

function chunkMatchesVerse(chunkVerse: string | undefined, expectedVerse: string): boolean {
  if (!chunkVerse) return false;

  const actual = parseVerseRange(chunkVerse);
  const expected = parseVerseRange(expectedVerse);
  if (!actual || !expected) return normalizeForMatch(chunkVerse) === normalizeForMatch(expectedVerse);

  return actual.start <= expected.end && expected.start <= actual.end;
}

function chunkMatchesRef(chunk: SourceChunk, ref: ParsedRef): boolean {
  if (chunk.source !== "scriptures") return false;
  const sameBook = normalizeBookForStrictMatch(chunk.book ?? "") === ref.book;
  if (!sameBook) return false;
  if (ref.chapter === undefined) return true;
  if (chunk.chapter !== ref.chapter) return false;
  if (ref.verse === undefined) return true;
  return chunkMatchesVerse(chunk.verse, ref.verse);
}

interface RefMetrics {
  firstRank: number | null; // 1-based rank of first matching chunk
  recall: number; // distinct expected refs found / total expected
  reciprocalRank: number; // 1/firstRank, or 0
}

function refMetrics(results: SourceChunk[], refs: string[]): RefMetrics {
  if (refs.length === 0) {
    return { firstRank: null, recall: NaN, reciprocalRank: NaN };
  }
  const parsed = refs.map(parseRef);
  let firstRank: number | null = null;
  const matched = new Set<number>();
  results.forEach((chunk, i) => {
    parsed.forEach((ref, ri) => {
      if (chunkMatchesRef(chunk, ref)) {
        matched.add(ri);
        if (firstRank === null) firstRank = i + 1;
      }
    });
  });
  return {
    firstRank,
    recall: matched.size / refs.length,
    reciprocalRank: firstRank ? 1 / firstRank : 0,
  };
}

interface StructuralResult {
  languageOk: boolean | null; // null = not asserted
  sourcesPresentOk: boolean | null;
  titleOk: boolean | null;
  speakerOk: boolean | null;
  contentOk: boolean | null;
  minResultsOk: boolean | null;
}

function containsAny(value: string, needles: string[] | undefined): boolean | null {
  if (!needles || needles.length === 0) return null;
  const normalized = normalizeForMatch(value);
  return needles.some((needle) => normalized.includes(normalizeForMatch(needle)));
}

function structuralChecks(c: EvalCase, results: SourceChunk[]): StructuralResult {
  let languageOk: boolean | null = null;
  if (c.expectScriptureLanguage) {
    const scriptureChunks = results.filter((r) => r.source === "scriptures");
    languageOk =
      scriptureChunks.length > 0 &&
      scriptureChunks.every((r) => r.language === c.expectScriptureLanguage);
  }
  let sourcesPresentOk: boolean | null = null;
  if (c.expectSourcePresent && c.expectSourcePresent.length > 0) {
    const present = new Set(results.map((r) => r.source));
    sourcesPresentOk = c.expectSourcePresent.every((s) => present.has(s));
  }
  const titleOk =
    c.expectTitleAnyOf && c.expectTitleAnyOf.length > 0
      ? results.some((r) => containsAny(r.title ?? "", c.expectTitleAnyOf))
      : null;
  const speakerOk =
    c.expectSpeakerAnyOf && c.expectSpeakerAnyOf.length > 0
      ? results.some((r) => containsAny(r.speaker ?? "", c.expectSpeakerAnyOf))
      : null;
  const contentOk =
    c.expectContentAnyOf && c.expectContentAnyOf.length > 0
      ? results.some((r) =>
          containsAny([r.text, r.title, r.section, r.book].filter(Boolean).join(" "), c.expectContentAnyOf)
        )
      : null;
  let minResultsOk: boolean | null = null;
  if (c.minResults !== undefined) {
    minResultsOk = results.length >= c.minResults;
  }
  return { languageOk, sourcesPresentOk, titleOk, speakerOk, contentOk, minResultsOk };
}

async function buildCandidates(
  c: EvalCase,
  rerank: boolean
): Promise<{ primary: SourceChunk[]; combined: SourceChunk[] }> {
  const language: Language = c.language ?? "eng";
  const topK = c.topK ?? DEFAULT_TOPK;
  const sources = c.kind === "scripture" ? (["scriptures"] as const).slice() : c.sources ?? DEFAULT_SOURCES;

  // NOTE: we intentionally do NOT replicate lookup_scripture_passage's strict
  // book+chapter filter here. That filter currently compares against
  // parseScriptureSelection().canonicalBook, which still returns ITALIAN book
  // names (legacy index) and so never matches the English chunk labels — the
  // tool silently falls back to unfiltered semantic results. Bare retrieve +
  // expansion therefore mirrors the tool's *effective* behavior, and lets the
  // `expectScriptureLanguage` / `expectRefsAnyOf` checks surface the real gaps
  // (Italian leakage; specific chapters not ranking into the top-k).
  //
  // `rerank` is forced here (not read from env) so the off/on arms are the only
  // variable; `diversity`/`multiQuery` follow their env flags and apply to both.
  const primary = await retrieve(c.query, sources, language, topK, { rerank });

  const related =
    c.kind === "scripture"
      ? await expandRelatedContext(primary, language, { cap: SCRIPTURE_RELATED_CAP })
      : await expandRelatedContext(primary, language, {
          fromTopN: SEMANTIC_FROM_TOP_N,
          cap: SEMANTIC_RELATED_CAP,
          sources,
        });
  return { primary, combined: [...primary, ...related] };
}

// Graph rerank is held constant across both arms (applied per its env flag), so
// it is not the off→on variable.
function applyGraphRerank(c: EvalCase, primary: SourceChunk[], combined: SourceChunk[]): SourceChunk[] {
  if (!isGraphRerankEnabled()) return combined;
  if (c.kind === "scripture") {
    const related = combined.slice(primary.length);
    return graphRerank(primary, related, { rerankSeeds: false });
  }
  return graphRerank(combined, [], { rerankSeeds: true });
}

interface CaseReport {
  id: string;
  kind: string;
  resultCount: number;
  baseline: RefMetrics;
  reranked: RefMetrics;
  structural: StructuralResult;
  error?: string;
}

function fmt(n: number): string {
  return Number.isNaN(n) ? "  -  " : n.toFixed(3);
}

function structuralCell(v: boolean | null): string {
  return v === null ? " - " : v ? "PASS" : "FAIL";
}

async function main() {
  const filter = process.argv.slice(2).join(" ").toLowerCase();
  const cases = filter
    ? EVAL_CASES.filter((c) => c.id.toLowerCase().includes(filter) || c.query.toLowerCase().includes(filter))
    : EVAL_CASES;

  if (cases.length === 0) {
    console.error(`No cases matched filter "${filter}".`);
    process.exit(1);
  }

  const onOff = (v: boolean) => (v ? "on" : "off");
  console.log(`\nRunning ${cases.length} eval case(s)${filter ? ` (filter: "${filter}")` : ""}...`);
  console.log(
    `off→on = cross-encoder rerank (RAG_RERANK) | held constant: graph-rerank ${onOff(
      isGraphRerankEnabled()
    )} | both arms: multi-query ${onOff(isMultiQueryEnabled())}, diversity ${onOff(
      isDiversityEnabled()
    )}\n`
  );

  const reports: CaseReport[] = [];
  for (const c of cases) {
    try {
      // OFF arm: no cross-encoder rerank. ON arm: RAG_RERANK applied. Graph
      // rerank is applied identically to both so it is not the variable.
      const off = await buildCandidates(c, false);
      const on = await buildCandidates(c, true);
      const offRanked = applyGraphRerank(c, off.primary, off.combined);
      const onRanked = applyGraphRerank(c, on.primary, on.combined);
      const refs = c.expectRefsAnyOf ?? [];
      reports.push({
        id: c.id,
        kind: c.kind,
        resultCount: on.combined.length,
        baseline: refMetrics(offRanked, refs),
        reranked: refMetrics(onRanked, refs),
        structural: structuralChecks(c, onRanked),
      });
      process.stdout.write(".");
    } catch (err) {
      reports.push({
        id: c.id,
        kind: c.kind,
        resultCount: 0,
        baseline: { firstRank: null, recall: NaN, reciprocalRank: NaN },
        reranked: { firstRank: null, recall: NaN, reciprocalRank: NaN },
        structural: {
          languageOk: null,
          sourcesPresentOk: null,
          titleOk: null,
          speakerOk: null,
          contentOk: null,
          minResultsOk: null,
        },
        error: err instanceof Error ? err.message : String(err),
      });
      process.stdout.write("x");
    }
  }
  console.log("\n");

  // Per-case table.
  const header = [
    "id".padEnd(26),
    "n".padStart(3),
    "rank(off→on)".padEnd(14),
    "recall(off→on)".padEnd(16),
    "lang".padEnd(5),
    "src".padEnd(5),
    "ttl".padEnd(5),
    "spk".padEnd(5),
    "txt".padEnd(5),
    "min".padEnd(5),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of reports) {
    if (r.error) {
      console.log(`${r.id.padEnd(26)} ERROR: ${r.error}`);
      continue;
    }
    const rankCell = `${r.baseline.firstRank ?? "—"}→${r.reranked.firstRank ?? "—"}`.padEnd(14);
    const recallCell = `${fmt(r.baseline.recall)}→${fmt(r.reranked.recall)}`.padEnd(16);
    console.log(
      [
        r.id.padEnd(26),
        String(r.resultCount).padStart(3),
        rankCell,
        recallCell,
        structuralCell(r.structural.languageOk).padEnd(5),
        structuralCell(r.structural.sourcesPresentOk).padEnd(5),
        structuralCell(r.structural.titleOk).padEnd(5),
        structuralCell(r.structural.speakerOk).padEnd(5),
        structuralCell(r.structural.contentOk).padEnd(5),
        structuralCell(r.structural.minResultsOk).padEnd(5),
      ].join(" ")
    );
  }

  // Aggregates.
  const ok = reports.filter((r) => !r.error);
  const withRefs = ok.filter((r) => !Number.isNaN(r.baseline.recall));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const mrrOff = mean(withRefs.map((r) => r.baseline.reciprocalRank));
  const mrrOn = mean(withRefs.map((r) => r.reranked.reciprocalRank));
  const recallOff = mean(withRefs.map((r) => r.baseline.recall));
  const recallOn = mean(withRefs.map((r) => r.reranked.recall));

  const structuralAll = ok.flatMap((r) =>
    [
      r.structural.languageOk,
      r.structural.sourcesPresentOk,
      r.structural.titleOk,
      r.structural.speakerOk,
      r.structural.contentOk,
      r.structural.minResultsOk,
    ].filter((v): v is boolean => v !== null)
  );
  const structuralPass = structuralAll.filter(Boolean).length;

  let improved = 0;
  let worsened = 0;
  for (const r of withRefs) {
    const a = r.baseline.firstRank ?? Infinity;
    const b = r.reranked.firstRank ?? Infinity;
    if (b < a) improved++;
    else if (b > a) worsened++;
  }

  console.log("\n=== Aggregate (off→on = cross-encoder rerank) ===");
  console.log(`cases run:            ${ok.length}/${reports.length}`);
  console.log(`structural checks:    ${structuralPass}/${structuralAll.length} pass`);
  console.log(`MRR     (rerank off): ${fmt(mrrOff)}   (rerank on): ${fmt(mrrOn)}   Δ ${fmt(mrrOn - mrrOff)}`);
  console.log(`recall  (rerank off): ${fmt(recallOff)}   (rerank on): ${fmt(recallOn)}   Δ ${fmt(recallOn - recallOff)}`);
  console.log(`rerank first-rank:    ${improved} improved, ${worsened} worsened, ${withRefs.length - improved - worsened} unchanged`);

  // Persist JSON.
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "results");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(outDir, `eval-${stamp}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        indexLanguage: process.env.RAG_INDEX_LANGUAGE ?? "eng",
        index: process.env.PINECONE_INDEX ?? "lds-rag-v1",
        variable: "rerank",
        flags: {
          graphRerank: isGraphRerankEnabled(),
          multiQuery: isMultiQueryEnabled(),
          diversity: isDiversityEnabled(),
        },
        aggregate: { mrrOff, mrrOn, recallOff, recallOn, structuralPass, structuralTotal: structuralAll.length, improved, worsened },
        reports,
      },
      null,
      2
    )
  );
  console.log(`\nWrote ${outPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
