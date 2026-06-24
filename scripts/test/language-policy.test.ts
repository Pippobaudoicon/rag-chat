/**
 * Language-policy suite for tool-specific language routing.
 *
 * Run: `npm run test:language-policy`
 *
 * Pure and deterministic — no LLM/network. The routing model call and the
 * resolver's router are injected, so these assert the routing *contract*:
 * the local fast path skips the model, cross-language prompts translate exactly
 * once through the dedicated routing model, the one-shot fallback fires at most
 * once, and the request-scoped resolver memoizes by (query, target).
 *
 * (Phase A of docs/TOOL_SPECIFIC_LANGUAGE_ROUTING_PLAN.md. Tool-policy and route
 * integration cases are added as later phases land.)
 */
import { readFileSync } from "node:fs";
import {
  detectPromptLanguage,
  routeQueryLanguage,
  getRoutingModel,
  getRoutingFallbackModel,
  type RoutingModelRequest,
} from "@/lib/rag/language-routing";
import { createRetrievalQueryResolver } from "@/lib/rag/retrieval-query-resolver";
import { buildUserMessage } from "@/lib/rag/system-prompt";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  if (!cond) failures += 1;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail && !cond ? `  (${detail})` : ""}`);
}

// A routing-model stub: records every request and returns/throws as configured.
function makeCall(
  behavior: (req: RoutingModelRequest, callIndex: number) =>
    | { inputLanguageCode: string; inputLanguageName: string; searchQuery: string }
    | "throw"
) {
  const requests: RoutingModelRequest[] = [];
  const call = async (req: RoutingModelRequest) => {
    const result = behavior(req, requests.length);
    requests.push(req);
    if (result === "throw") throw new Error("structured-output failure");
    return result;
  };
  return { call, requests };
}

async function main() {
  // Keep CHAT_MODEL set to a sentinel so we can prove routing ignores it.
  process.env.CHAT_MODEL = "sentinel/chat-model";
  delete process.env.RAG_ROUTING_MODEL;
  delete process.env.RAG_ROUTING_FALLBACK_MODEL;

  // ── Local answer-language detection (no model, no translation) ────────────
  // tinyld only earns an explicit answer-language hint when confident (>= 0.9).
  // Short greetings, wrong low-confidence guesses, and mixed-language
  // instructions must stay `und` so we never assert the wrong language — the
  // generation model then naturally matches the original prompt.
  type DetectCase = { label: string; q: string; code: string; scripture?: "eng" | "ita" };
  const detectionCases: DetectCase[] = [
    // Low-confidence short greetings / wrong guesses -> und (the reported bug).
    { label: "`Hello` -> und (was it@0.20)", q: "Hello", code: "und" },
    { label: "`Grazie` -> und (was pl@0.17)", q: "Grazie", code: "und" },
    { label: "`Come stai?` -> und (was it@0.13)", q: "Come stai?", code: "und" },
    { label: "`Ciao, come stai?` -> und (it@0.09, too low to assert)", q: "Ciao, come stai?", code: "und" },
    // Mixed-language instructions: dominantly English by tokens, but the user
    // asked for another language -> und, so the model follows the instruction.
    { label: "Italian instruction over English -> und", q: "Rispondi in italiano: What does it mean that faith is not to have a perfect knowledge of things?", code: "und" },
    { label: "Spanish instruction over English -> und", q: "Responde en español: What does it mean that faith is a principle of action?", code: "und" },
    // Confident, genuinely single-language prompts -> detected hint.
    { label: "`What is faith?` -> en", q: "What is faith?", code: "en", scripture: "eng" },
    { label: "Italian topical question -> it", q: "Che cosa insegna il Libro di Mormon riguardo al pentimento?", code: "it", scripture: "ita" },
    // Scripture references, both languages.
    { label: "Italian `Giovanni 3:16` -> it (Italian scripture)", q: "Giovanni 3:16", code: "it", scripture: "ita" },
    { label: "English `John 3:16` -> und (English fallback at the tool)", q: "John 3:16", code: "und" },
    { label: "bare reference `Alma 32:21` -> und", q: "Alma 32:21", code: "und" },
  ];
  for (const c of detectionCases) {
    const got = detectPromptLanguage(c.q);
    const codeOk = got.code === c.code;
    const scriptureOk = got.scriptureLanguage === c.scripture;
    // `und` must carry no concrete language name and no scripture preference.
    const undShapeOk = c.code !== "und" || (got.name === "the user's language" && got.scriptureLanguage === undefined);
    check(c.label, codeOk && scriptureOk && undShapeOk, JSON.stringify(got));
  }

  // ── Identity: English prompt on English index skips the model entirely ────
  {
    const { call, requests } = makeCall(() => "throw");
    const r = await routeQueryLanguage("What is faith?", { indexLanguage: "eng", call });
    check("English-on-English -> identity, zero translation calls", requests.length === 0 && r.translated === false && r.searchQuery === "What is faith?" && r.routingMs === 0);
  }

  // ── Translation: Italian prompt -> English query via the routing model ─────
  {
    const { call, requests } = makeCall(() => ({
      inputLanguageCode: "it",
      inputLanguageName: "Italian",
      searchQuery: "What does the Book of Mormon teach about repentance?",
    }));
    const r = await routeQueryLanguage(
      "Che cosa insegna il Libro di Mormon riguardo al pentimento?",
      { indexLanguage: "eng", call }
    );
    check("Italian prompt -> exactly one translation call", requests.length === 1);
    check("Italian prompt -> translated English query", r.translated === true && r.searchQuery === "What does the Book of Mormon teach about repentance?");
    check("routing uses RAG_ROUTING_MODEL, not CHAT_MODEL", requests[0].model === getRoutingModel() && requests[0].model !== process.env.CHAT_MODEL, requests[0]?.model);
    check("default routing model is openai/gpt-oss-120b", requests[0].model === "openai/gpt-oss-120b", requests[0]?.model);
    check("GPT-OSS routing uses low reasoning effort + 600-token budget", requests[0].reasoningEffort === "low" && requests[0].maxOutputTokens === 600);
    check("translated result records routingModel, no fallback", r.routingModel === getRoutingModel() && r.routingFallbackUsed === false);
  }

  // ── One-shot fallback: primary fails once, fallback succeeds ───────────────
  {
    const { call, requests } = makeCall((_req, i) =>
      i === 0
        ? "throw"
        : { inputLanguageCode: "it", inputLanguageName: "Italian", searchQuery: "faith in Jesus Christ" }
    );
    const r = await routeQueryLanguage("Cos'è la fede in Gesù Cristo?", { indexLanguage: "eng", call });
    check("primary failure -> exactly one fallback call (2 total)", requests.length === 2);
    check("fallback uses RAG_ROUTING_FALLBACK_MODEL", requests[1].model === getRoutingFallbackModel() && requests[1].model === "openai/gpt-5.4-mini");
    check("fallback success flagged + recorded as routingModel", r.routingFallbackUsed === true && r.routingModel === getRoutingFallbackModel() && r.searchQuery === "faith in Jesus Christ");
  }

  // ── Both fail: fail open, no retry loop ────────────────────────────────────
  {
    const { call, requests } = makeCall(() => "throw");
    const original = "Cos'è la fede in Gesù Cristo?";
    const r = await routeQueryLanguage(original, { indexLanguage: "eng", call });
    check("primary + fallback failure -> exactly 2 calls (no retry loop)", requests.length === 2);
    check("both fail -> fail open with original query + und", r.translated === false && r.searchQuery === original && r.inputLanguageCode === "und" && r.routingModel === undefined);
  }

  // ── Resolver memoization: repeated identical (query, target) -> one call ───
  {
    let calls = 0;
    const router = (async (query: string) => {
      calls += 1;
      return {
        originalQuery: query,
        searchQuery: "translated",
        inputLanguageCode: "it",
        inputLanguageName: "Italian",
        indexLanguage: "eng" as const,
        indexLanguageName: "English",
        translated: true,
        routingMs: 5,
        routingModel: "openai/gpt-oss-120b",
        routingFallbackUsed: false,
      };
    }) as unknown as typeof routeQueryLanguage;
    const resolver = createRetrievalQueryResolver({ router });
    const a = await resolver.resolve("Domanda topica", "eng");
    const b = await resolver.resolve("  domanda topica  ", "eng"); // normalized to same key
    await resolver.resolve("altra domanda", "eng"); // distinct -> separate call
    check("resolver memoizes identical (query, target) -> one translation", calls === 2, `calls=${calls}`);
    check("resolver returns the same memoized routing object", a === b);
  }

  // ── Phase B: no-tool turn makes zero routing-model calls ──────────────────
  // The chat preamble no longer routes globally: it detects prompt language
  // locally (pure, no model) and never calls routeQueryLanguage. A no-tool turn
  // (e.g. "Ciao, come stai?") therefore issues no routing-model call at all —
  // routing is lazy, inside the English-corpus tools, which a no-tool turn never
  // invokes. Proven statically against the route source plus the user-message
  // contract (the route handler can't be imported here — it pulls Clerk/DB).
  const routeSrc = readFileSync("src/app/api/chat/route.ts", "utf8");
  check("chat route no longer calls routeQueryLanguage (no global routing)", !routeSrc.includes("routeQueryLanguage"));
  check("chat route detects prompt language locally", routeSrc.includes("detectPromptLanguage("));
  check("chat route records no `routing` latency phase", !routeSrc.includes('phase("routing"'));

  // The no-tool greeting "Ciao, come stai?" is low-confidence (und): the user
  // message must NOT assert a concrete language, it falls back to "match the
  // original prompt", and it carries no globally translated "Search query" block.
  const greetingMsg = buildUserMessage(
    "Ciao, come stai?",
    [],
    { uiLanguage: "eng", promptLanguage: detectPromptLanguage("Ciao, come stai?") }
  );
  check("`Ciao, come stai?` message does not assert a wrong language", !/Answer in Italian \(it\)/.test(greetingMsg));
  check("`Ciao, come stai?` message falls back to original-prompt language", /Answer in the same language as the user's original prompt/.test(greetingMsg));
  check("`Ciao, come stai?` message has no translated Search query block", !/Search query/i.test(greetingMsg));

  // A confident single-language prompt still gets the explicit answer-language hint.
  const italianMsg = buildUserMessage(
    "Che cosa insegna il Libro di Mormon riguardo al pentimento?",
    [],
    { uiLanguage: "eng", promptLanguage: detectPromptLanguage("Che cosa insegna il Libro di Mormon riguardo al pentimento?") }
  );
  check("confident Italian prompt -> explicit `Answer in Italian (it)` hint", italianMsg.includes("Answer in Italian (it)"));

  console.log(`\n${failures === 0 ? "All language-policy checks passed" : `${failures} check(s) failed`}`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
