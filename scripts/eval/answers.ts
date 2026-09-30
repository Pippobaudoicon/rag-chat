/**
 * Answer-level A/B eval for the chat tool loop.
 *
 *   base     the chat route's tool loop (after retrieval every tool is off).
 *   nothink  base + DeepSeek thinking disabled (providerOptions.deepseek.thinking).
 *
 * Each Italian question runs through the real pipeline pieces the chat route
 * uses (buildSystemPrompt/buildUserMessage, createRagTools with a Pro-like turn,
 * prepareChatToolStep, streamText over the AI Gateway). No DB, Clerk, memory, or
 * Redis cache: every run pays real retrieval. Variant order rotates per question.
 * A blind pairwise judge then compares each pair in PAIRS (chit-chat skipped).
 *
 * Usage (same env as `pnpm run eval`; .env.local wins over .env):
 *   pnpm exec dotenv -o -e .env -e .env.local -- tsx scripts/eval/answers.ts [idFilter]
 * Writes scripts/eval/results/answers-<stamp>.json (gitignored).
 */
import {
  gateway,
  generateText,
  Output,
  smoothStream,
  stepCountIs,
  streamText,
  type StepResult,
  type ToolSet,
} from "ai";
import { z } from "zod";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSystemPrompt, buildUserMessage } from "@/lib/rag/system-prompt";
import { createRagTools } from "@/lib/rag/tools";
import { prepareChatToolStep } from "@/lib/rag/tool-loop-policy";
import { getIndexLanguage } from "@/lib/rag/language-routing";
import { retrievalFlagsSignature } from "@/lib/rag/flags";
import { extractCitationMarkers } from "@/lib/rag/citation-markers";
import { DEFAULT_SOURCES, type SourceChunk } from "@/lib/types";

// Production flags (signature lr0rr1mq0mmr0), forced so .env drift can't leak in.
Object.assign(process.env, {
  RAG_LANGUAGE_ROUTING: "false",
  RAG_RERANK: "true",
  RAG_MULTI_QUERY: "false",
  RAG_MMR: "false",
});
// No Redis: every run retrieves for real and nothing is written to the shared cache.
for (const key of ["UPSTASH_REDIS_REST_URL", "UPSTASH_KV_REST_API_URL", "KV_REST_API_URL"]) {
  delete process.env[key];
}

const CHAT_MODEL = process.env.CHAT_MODEL ?? "deepseek/deepseek-v4.1-flash";
const JUDGE_MODEL = "anthropic/claude-sonnet-5.5";
const MAX_OUTPUT_TOKENS = Number(process.env.CHAT_MAX_OUTPUT_TOKENS) || 6000; // route default
const REPS = 1;

// Copied verbatim from src/app/api/chat/route.ts (inline there).
const TOOL_USE_COMPLETE =
  "Tool use is complete. Produce the final user-facing answer now using the retrieved or preloaded sources. Do not emit tool-call syntax, XML, DSML, or another tool request.";

const QUESTIONS = [
  { id: "doctrine-faith", q: "Cosa insegna il Libro di Mormon sulla fede in Gesù Cristo?" },
  { id: "doctrine-repentance", q: "Come posso pentirmi davvero dei miei peccati?" },
  { id: "scripture-alma-32", q: "Cosa insegna Alma 32:21-43 sulla fede?" },
  { id: "talk-nelson-revelation", q: "Cosa ha detto il presidente Nelson sulla rivelazione personale?" },
  { id: "talk-think-celestial", q: 'Di cosa parla il discorso "Pensate in modo celeste!" del presidente Nelson?' },
  { id: "handbook-bishop", q: "Secondo il Manuale generale, quali sono i compiti principali del vescovo?" },
  { id: "multi-charity", q: "Confronta ciò che insegna Moroni 7:44-48 sulla carità con ciò che i dirigenti della Chiesa hanno detto sulla carità nella conferenza generale." },
  { id: "chitchat-thanks", q: "Grazie mille, mi sei stato davvero utile!" },
];

type Variant = "base" | "nothink";
const VARIANTS: Variant[] = ["base", "nothink"];
const PAIRS = [["base", "nothink"]] as const;

type Run = Awaited<ReturnType<typeof runTurn>>;

const gatewayMeta = (step: { providerMetadata?: unknown }) =>
  ((step.providerMetadata as { gateway?: Record<string, unknown> } | undefined)?.gateway ?? {}) as {
    cost?: string;
    routing?: { finalProvider?: string };
  };

async function runTurn(question: string, variant: Variant) {
  const sources: SourceChunk[] = [];
  const retrievals: Array<{ tool: string; ms?: number; n?: number }> = [];
  const ragTools = createRagTools({
    language: getIndexLanguage(),
    sources: DEFAULT_SOURCES,
    topK: 20,
    initialChunks: [],
    maxChunks: 50,
    maxRetrievalCalls: 2,
    onSources: (chunks) => sources.push(...chunks),
    onProgress: (p) => {
      if (p.phase === "tools" && p.toolName) retrievals.push({ tool: p.toolName, ms: p.elapsedMs, n: p.sourceCount });
    },
  });
  const tools: ToolSet = ragTools;
  const system = buildSystemPrompt();

  const t0 = performance.now();
  const result = streamText({
    model: gateway(CHAT_MODEL),
    system,
    messages: [{ role: "user", content: buildUserMessage(question, [], { uiLanguage: "ita" }) }],
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    stopWhen: stepCountIs(4),
    abortSignal: AbortSignal.timeout(180_000),
    tools,
    prepareStep: ({ steps }) => {
      const policy = prepareChatToolStep(steps, false);
      return policy ? { ...policy, system: `${system}\n\n${TOOL_USE_COMPLETE}` } : undefined;
    },
    providerOptions: variant === "nothink" ? { deepseek: { thinking: { type: "disabled" } } } : undefined,
    experimental_transform: smoothStream({ delayInMs: 20, chunking: "word" }),
  });

  // Per-step first text-delta: the final step's is the first ANSWER text (step 0's
  // is the pre-tool progress sentence on retrieval turns).
  const firstTextByStep: number[] = [];
  let step = -1;
  let error: string | undefined;
  try {
    for await (const part of result.fullStream) {
      if (part.type === "start-step") step += 1;
      else if (part.type === "text-delta" && part.text.trim()) firstTextByStep[step] ??= performance.now() - t0;
      else if (part.type === "error") error = String(part.error);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const totalMs = performance.now() - t0;
  // Keeps the event loop alive: a never-settling promise would otherwise exit Node 0.
  const within = <T,>(p: PromiseLike<T>, fallback: T) =>
    Promise.race([Promise.resolve(p), new Promise<T>((r) => setTimeout(() => { error ??= "steps/usage timeout"; r(fallback); }, 30_000))]);
  const steps: StepResult<ToolSet>[] = await within(result.steps, []).catch(() => []);
  const usage = await within(result.totalUsage, undefined).catch(() => undefined);

  const answer = steps.at(-1)?.text ?? "";
  const cited = extractCitationMarkers(answer);

  return {
    variant,
    error,
    firstAnswerTextMs: firstTextByStep[steps.length - 1] ?? null,
    firstAnyTextMs: firstTextByStep.find((ms) => ms !== undefined) ?? null,
    firstTextByStep,
    totalMs,
    steps: steps.length,
    finishReasons: steps.map((s) => s.finishReason),
    tools: steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)),
    toolInputs: steps.flatMap((s) => s.toolCalls.map((c) => ({ tool: c.toolName, input: c.input }))),
    retrievals,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0, // includes reasoning
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? 0,
    cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    costUsd: steps.reduce((sum, s) => sum + Number(gatewayMeta(s).cost ?? 0), 0),
    providers: steps.map((s) => gatewayMeta(s).routing?.finalProvider ?? "?"),
    sourceCount: sources.length,
    uniqueCitations: cited.length,
    outOfRangeCitations: cited.filter((n) => n > sources.length).length,
    answerChars: answer.length,
    stepTexts: steps.map((s) => s.text),
    answer,
    sources: sources.map(({ title, speaker, book, chapter, verse, source, text, url }) => ({
      title, speaker, book, chapter, verse, source, url, text: text.slice(0, 1200),
    })),
  };
}

// ── Judge ─────────────────────────────────────────────────────────────────────
const judgeSchema = z.object({
  faithfulness: z.enum(["A", "B", "tie"]).describe("Claims supported by the cited sources; [N] markers point at sources that back them"),
  completeness: z.enum(["A", "B", "tie"]).describe("Answers the question fully with the most relevant available sources"),
  italian: z.enum(["A", "B", "tie"]).describe("Natural, correct Italian; answers in Italian"),
  winner: z.enum(["A", "B", "tie"]).describe("Overall; faithfulness weighs most"),
  reason: z.string().describe("One or two sentences explaining the overall verdict"),
});

function sourceBlock(run: Run): string {
  if (run.sources.length === 0) return "(no sources retrieved)";
  const cited = new Set(extractCitationMarkers(run.answer));
  return run.sources
    .map((s, i) => {
      const ref = s.book ? `${s.book} ${s.chapter ?? ""}${s.verse ? `:${s.verse}` : ""}`.trim() : "";
      const head = `[${i + 1}] ${[s.source, s.title, s.speaker, ref].filter(Boolean).join(" | ")}`;
      return cited.has(i + 1) ? `${head}\n${s.text}` : `${head} (not cited; text omitted)`;
    })
    .join("\n\n");
}

async function judge(question: string, a: Run, b: Run) {
  const { output, providerMetadata } = await generateText({
    model: gateway(JUDGE_MODEL),
    output: Output.object({ schema: judgeSchema }),
    providerOptions: { anthropic: { effort: "low" } },
    system:
      "You are a strict, impartial evaluator of source-grounded answers from an Italian-language Latter-day Saint study assistant. " +
      "Each answer comes with ITS OWN numbered source list (the [N] numbering differs between answers). " +
      "Judge: (1) faithfulness — every substantive claim is supported by the sources it cites, [N] markers point at sources that back the claim, nothing invented; " +
      "(2) completeness — answers the actual question well, using the most relevant available sources; " +
      "(3) Italian quality — fluent, natural, correct Italian. Faithfulness weighs most. Length is not a virtue by itself. " +
      "Answer order is random; do not favor A or B. Use tie when the answers are equivalent.",
    prompt: [
      `Question:\n${question}`,
      `=== Sources for Answer A ===\n${sourceBlock(a)}`,
      `=== Answer A ===\n${a.answer || "(empty answer)"}`,
      `=== Sources for Answer B ===\n${sourceBlock(b)}`,
      `=== Answer B ===\n${b.answer || "(empty answer)"}`,
    ].join("\n\n"),
  });
  return { ...output, costUsd: Number(gatewayMeta({ providerMetadata }).cost ?? 0) };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function main() {
  const filter = process.argv.slice(2).join(" ").toLowerCase();
  const questions = QUESTIONS.filter((q) => q.id.includes(filter));
  console.log(`model ${CHAT_MODEL} | flags ${retrievalFlagsSignature()} | ${questions.length} questions x ${VARIANTS.length} variants x ${REPS} rep(s)`);

  const runs: Array<Run & { qid: string; rep: number }> = [];
  for (let rep = 0; rep < REPS; rep++) {
    for (const [qi, { id, q }] of questions.entries()) {
      // Rotate variant order per question (and per rep) to spread provider/time bias.
      const order = VARIANTS.map((_, i) => VARIANTS[(i + qi + rep) % VARIANTS.length]);
      for (const variant of order) {
        const run = await runTurn(q, variant);
        runs.push({ ...run, qid: id, rep });
        console.log(
          `${id.padEnd(26)} ${variant} r${rep} ${(run.totalMs / 1000).toFixed(1)}s ans@${((run.firstAnswerTextMs ?? NaN) / 1000).toFixed(1)}s ` +
            `tools=[${run.tools.join(",")}] out=${run.outputTokens} (reason ${run.reasoningTokens}) $${run.costUsd.toFixed(5)} ` +
            `cites=${run.uniqueCitations}/${run.sourceCount} oor=${run.outOfRangeCitations} ${run.providers.join(">")}${run.error ? ` ERROR ${run.error}` : ""}`
        );
      }
    }
  }

  const judgments: Array<Record<string, unknown>> = [];
  for (const [x, y] of PAIRS) {
    for (const { id, q } of questions.filter((q) => !q.id.startsWith("chitchat"))) {
      for (let rep = 0; rep < REPS; rep++) {
        const rx = runs.find((r) => r.qid === id && r.rep === rep && r.variant === x)!;
        const ry = runs.find((r) => r.qid === id && r.rep === rep && r.variant === y)!;
        const flip = Math.random() < 0.5;
        const v = await judge(q, flip ? ry : rx, flip ? rx : ry);
        const toVariant = (w: string) => (w === "tie" ? "tie" : (w === "A") !== flip ? x : y);
        const verdict = {
          pair: `${x} vs ${y}`, qid: id, rep, aIs: flip ? y : x,
          winner: toVariant(v.winner), faithfulness: toVariant(v.faithfulness),
          completeness: toVariant(v.completeness), italian: toVariant(v.italian),
          reason: v.reason, costUsd: v.costUsd,
        };
        judgments.push(verdict);
        console.log(`judge ${verdict.pair} ${id.padEnd(26)} winner=${verdict.winner} (faith ${verdict.faithfulness}, compl ${verdict.completeness}, ita ${verdict.italian}) — ${v.reason}`);
      }
    }
  }

  console.log("\nvariant  n  ans@p50  total@p50  out@p50  reason@p50  in@p50  $/turn@p50  $/turn(mean)  cites@p50  oor  steps@p50");
  for (const variant of VARIANTS) {
    const rs = runs.filter((r) => r.variant === variant);
    const col = (f: (r: Run) => number, d = 0) => median(rs.map(f)).toFixed(d);
    console.log(
      [variant.padEnd(7), String(rs.length).padStart(2), `${col((r) => (r.firstAnswerTextMs ?? NaN) / 1000, 1)}s`.padStart(7),
        `${col((r) => r.totalMs / 1000, 1)}s`.padStart(9), col((r) => r.outputTokens).padStart(7), col((r) => r.reasoningTokens).padStart(10),
        col((r) => r.inputTokens).padStart(7), `$${col((r) => r.costUsd, 5)}`.padStart(10),
        `$${(rs.reduce((s, r) => s + r.costUsd, 0) / rs.length).toFixed(5)}`.padStart(12),
        col((r) => r.uniqueCitations).padStart(9), String(rs.reduce((s, r) => s + r.outOfRangeCitations, 0)).padStart(4),
        col((r) => r.steps).padStart(9)].join("  ")
    );
  }
  for (const [x, y] of PAIRS) {
    const pair = `${x} vs ${y}`;
    const js = judgments.filter((j) => j.pair === pair);
    const count = (w: string) => js.filter((j) => j.winner === w).length;
    console.log(`judge ${pair}: ${x} wins ${count(x)}, ties ${count("tie")}, ${y} wins ${count(y)}`);
  }
  const runCost = runs.reduce((s, r) => s + r.costUsd, 0);
  const judgeCost = judgments.reduce((s, j) => s + (j.costUsd as number), 0);
  console.log(`spend: runs $${runCost.toFixed(4)} + judge $${judgeCost.toFixed(4)} = $${(runCost + judgeCost).toFixed(4)}`);

  const outDir = join(dirname(fileURLToPath(import.meta.url)), "results");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `answers-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outPath, JSON.stringify({ model: CHAT_MODEL, judgeModel: JUDGE_MODEL, flags: retrievalFlagsSignature(), runs, judgments }, null, 2));
  console.log(`wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
