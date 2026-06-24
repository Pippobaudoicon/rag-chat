import { generateText, gateway, Output } from "ai";
import { detectAll } from "tinyld";
import { z } from "zod";
import type { CorpusLanguage, Language } from "@/lib/types";

// Routing/translation is an independent workload from the final-answer model
// (`CHAT_MODEL`): a small, fast, reliable structured-output translator. Selected
// via a live AI Gateway benchmark (see docs/TOOL_SPECIFIC_LANGUAGE_ROUTING_PLAN.md
// §4.4). Both IDs stay env-configurable because availability/perf can change.
const DEFAULT_ROUTING_MODEL = "openai/gpt-oss-120b";
const DEFAULT_ROUTING_FALLBACK_MODEL = "openai/gpt-5.4-mini";

// GPT-OSS counts reasoning tokens against the output ceiling; a 600-token budget
// with low reasoning effort was the fastest reliable setting in the benchmark
// (smaller ceilings ended before producing the structured object).
const ROUTING_MAX_OUTPUT_TOKENS = 600;
const ROUTING_REASONING_EFFORT = "low" as const;

const CORPUS_LANGUAGE_NAMES: Record<CorpusLanguage, string> = {
  ita: "Italian",
  eng: "English",
};

// ISO 639-1 codes for the corpus languages — tinyld returns 2-letter codes, so
// the local detector's result is compared against these.
const CORPUS_LANGUAGE_BCP47: Record<CorpusLanguage, string> = {
  ita: "it",
  eng: "en",
};

// Indexed scripture languages keyed by their ISO 639-1 code. Mapping a detected
// prompt language to a scripture corpus is explicit (no UI-language coupling);
// languages absent here fall back to English at the scripture tool.
const ISO_TO_SCRIPTURE_LANGUAGE: Record<string, Language> = {
  en: "eng",
  it: "ita",
};

// Human-readable answer-language hints for the locally detected prompt language.
// Only a hint for the generation model — unknown codes stay generic so we never
// assert a language we cannot name.
const ISO_LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  it: "Italian",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
};

const GENERIC_LANGUAGE_NAME = "the user's language";

// Minimum tinyld accuracy required before we assert an explicit answer language.
// tinyld's accuracy is sharply bimodal on prompt-length text: confidently
// single-language input scores ~1.0, while short greetings ("Hello" -> it@0.20,
// "Grazie" -> pl@0.17, "Ciao, come stai?" -> it@0.09), wrong guesses, and
// mixed-language instructions ("Rispondi in italiano: <English>" -> en@0.76) all
// sit ≤ ~0.76. Gating at 0.9 keeps only the confident cluster and returns `und`
// for the rest — so we never inject a WRONG explicit "answer in X" instruction;
// the generation model then naturally matches the original prompt.
const PROMPT_LANGUAGE_MIN_CONFIDENCE = 0.9;

// Same-language fast-path thresholds (calibrated against tinyld). A *pure*
// index-language prompt classifies as that language with accuracy ~1.0 and a
// single detected language. Any language mixing — an instruction like
// "Rispondi in italiano: <English question>", or a non-English question quoting
// a long English passage — drops the dominant accuracy to ≤ ~0.83 and/or
// surfaces a significant secondary language. Requiring high dominance keeps
// those mixed/quoted prompts on the LLM translation path (codex review).
const LOCAL_DETECTION_MIN_CONFIDENCE = 0.9;
const LOCAL_DETECTION_MAX_SECONDARY = 0.15;

/**
 * Decide locally whether a prompt is confidently, dominantly in the index
 * language (so routing is identity and the LLM call can be skipped). Returns the
 * detected ISO 639-1 code on a match, or `null` when the LLM path must be used:
 * a different/undetectable language, low confidence, or a mixed-language prompt.
 * Pure (no network) so it can be unit-tested deterministically.
 */
export function detectIndexLanguageMatch(
  query: string,
  indexLanguage: CorpusLanguage
): string | null {
  const detections = detectAll(query.trim());
  const top = detections[0];
  if (!top || top.lang !== CORPUS_LANGUAGE_BCP47[indexLanguage]) return null;
  if (top.accuracy < LOCAL_DETECTION_MIN_CONFIDENCE) return null;
  const second = detections[1];
  if (second && second.accuracy >= LOCAL_DETECTION_MAX_SECONDARY) return null;
  return top.lang;
}

/**
 * Local, network-free answer-language context for a prompt. This is the turn's
 * language hint — it is NOT a retrieval translation (that stays lazy, inside the
 * English-corpus tools). `und` is preserved for short/ambiguous input instead of
 * guessing; the generation model then naturally matches the original prompt.
 */
export type PromptLanguage = {
  /** BCP-47/ISO-639-1 code where known, otherwise "und". */
  code: string;
  /** Human-readable answer-language hint for the generation model. */
  name: string;
  /** Indexed scripture corpus to prefer, when the prompt language has one. */
  scriptureLanguage?: Language;
  /** tinyld top-candidate accuracy, when a language was detected. */
  confidence?: number;
};

/**
 * Detect the prompt's language locally with `tinyld` (no network). Only returns
 * a concrete language when tinyld is confident (`accuracy >= 0.9`); short,
 * ambiguous, or mixed-language input stays `und` rather than guessing (so we
 * never assert the wrong answer language — the generation model then matches the
 * original prompt naturally). Known indexed scripture languages map explicitly
 * (`en -> eng`, `it -> ita`); other languages get a generic name and no
 * scripture preference (English fallback handled at the scripture tool).
 */
export function detectPromptLanguage(query: string): PromptLanguage {
  const trimmed = query.trim();
  const top = trimmed ? detectAll(trimmed)[0] : undefined;
  if (!top || top.accuracy < PROMPT_LANGUAGE_MIN_CONFIDENCE) {
    return { code: "und", name: GENERIC_LANGUAGE_NAME };
  }
  const code = top.lang;
  return {
    code,
    name: ISO_LANGUAGE_NAMES[code] ?? GENERIC_LANGUAGE_NAME,
    scriptureLanguage: ISO_TO_SCRIPTURE_LANGUAGE[code],
    confidence: top.accuracy,
  };
}

/**
 * Primary routing/translation model — `RAG_ROUTING_MODEL`, defaulting to a small
 * fast structured-output translator. Independent from `CHAT_MODEL` so the
 * final-answer model can change without touching the routing contract.
 */
export function getRoutingModel(): string {
  return process.env.RAG_ROUTING_MODEL?.trim() || DEFAULT_ROUTING_MODEL;
}

/** One-shot fallback model used once if the primary returns no structured output. */
export function getRoutingFallbackModel(): string {
  return process.env.RAG_ROUTING_FALLBACK_MODEL?.trim() || DEFAULT_ROUTING_FALLBACK_MODEL;
}

const languageRoutingSchema = z.object({
  inputLanguageCode: z
    .string()
    .min(2)
    .max(16)
    .describe("BCP-47 language code for the user's original prompt, for example fr, en, it, es."),
  inputLanguageName: z
    .string()
    .min(2)
    .max(80)
    .describe("Human-readable language name for the user's original prompt, in English."),
  searchQuery: z
    .string()
    .min(1)
    .describe("The user's query translated into the configured index language for retrieval."),
});

export interface QueryLanguageRouting {
  originalQuery: string;
  searchQuery: string;
  inputLanguageCode: string;
  inputLanguageName: string;
  indexLanguage: CorpusLanguage;
  indexLanguageName: string;
  translated: boolean;
  /** Measured translation duration (ms); 0 on the local same-language fast path. */
  routingMs: number;
  /** Model that produced the translation; absent on the fast path / fail-open. */
  routingModel?: string;
  /** True when the primary model failed and the one-shot fallback produced the result. */
  routingFallbackUsed: boolean;
}

/** Parsed structured routing output (the LLM translation result). */
type RoutingOutput = z.infer<typeof languageRoutingSchema>;

/** A single structured-output routing request — the injectable model seam. */
export interface RoutingModelRequest {
  model: string;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  reasoningEffort: typeof ROUTING_REASONING_EFFORT;
}

/**
 * Calls the routing model and returns the parsed structured object, or throws on
 * a structured-output failure. Default implementation hits the AI Gateway;
 * tests inject a stub so the routing logic stays network-free.
 */
export type RoutingModelCall = (req: RoutingModelRequest) => Promise<RoutingOutput>;

async function defaultRoutingCall(req: RoutingModelRequest): Promise<RoutingOutput> {
  const result = await generateText({
    model: gateway(req.model),
    system: req.system,
    prompt: req.prompt,
    maxOutputTokens: req.maxOutputTokens,
    providerOptions: { openai: { reasoningEffort: req.reasoningEffort } },
    output: Output.object({ schema: languageRoutingSchema }),
  });
  return result.output;
}

export function getIndexLanguage(): CorpusLanguage {
  // Defaults to English: lds-rag-v1 is the English-main corpus (scriptures also
  // carry Italian). Set RAG_INDEX_LANGUAGE=ita only to target the legacy index.
  const configured = process.env.RAG_INDEX_LANGUAGE?.trim().toLowerCase();
  return configured === "ita" || configured === "eng" ? configured : "eng";
}

export function getCorpusLanguageName(language: CorpusLanguage): string {
  return CORPUS_LANGUAGE_NAMES[language];
}

export async function routeQueryLanguage(
  query: string,
  options: {
    indexLanguage?: CorpusLanguage;
    /** Override the primary routing model (defaults to RAG_ROUTING_MODEL). */
    model?: string;
    /** Override the one-shot fallback model (defaults to RAG_ROUTING_FALLBACK_MODEL). */
    fallbackModel?: string;
    /** Injectable model call seam for tests; defaults to the AI Gateway call. */
    call?: RoutingModelCall;
  } = {}
): Promise<QueryLanguageRouting> {
  const indexLanguage = options.indexLanguage ?? getIndexLanguage();
  const indexLanguageName = getCorpusLanguageName(indexLanguage);
  const trimmedQuery = query.trim();

  // Local same-language fast-path. When the prompt is confidently, dominantly
  // in the index language, translation is identity and the routing LLM call is
  // pure latency/cost — so skip the model. Mixed/quoted-language prompts and
  // cross-language prompts (e.g. Italian → English index) fall through to the
  // LLM so translation and answer-language fidelity are preserved.
  const localCode = detectIndexLanguageMatch(trimmedQuery, indexLanguage);
  if (localCode) {
    return {
      originalQuery: trimmedQuery,
      searchQuery: trimmedQuery,
      inputLanguageCode: localCode,
      inputLanguageName: indexLanguageName,
      indexLanguage,
      indexLanguageName,
      translated: false,
      routingMs: 0,
      routingFallbackUsed: false,
    };
  }

  const call = options.call ?? defaultRoutingCall;
  const primaryModel = options.model ?? getRoutingModel();
  const fallbackModel = options.fallbackModel ?? getRoutingFallbackModel();
  const system = [
    "You detect the language of LDS search prompts and translate them for retrieval.",
    `The Pinecone index language is ${indexLanguageName}.`,
    "Return only structured data. Do not answer the question.",
    "Preserve scripture references, names, titles, speakers, and years.",
    "When a scripture book has a standard name in the index language, use that name.",
    "If the prompt is already in the index language, keep the search query semantically identical.",
  ].join("\n");
  const prompt = `User prompt:\n${trimmedQuery}`;
  const buildRequest = (model: string): RoutingModelRequest => ({
    model,
    system,
    prompt,
    maxOutputTokens: ROUTING_MAX_OUTPUT_TOKENS,
    reasoningEffort: ROUTING_REASONING_EFFORT,
  });

  const start = performance.now();
  let output: RoutingOutput | null = null;
  let routingModel: string | undefined;
  let routingFallbackUsed = false;

  try {
    output = await call(buildRequest(primaryModel));
    routingModel = primaryModel;
  } catch (primaryError) {
    // One-shot fallback only — never a retry loop. A primary structured-output
    // failure retries exactly once with the configured fallback model.
    console.error(`Language routing primary model failed (${primaryModel}); trying fallback`, primaryError);
    try {
      output = await call(buildRequest(fallbackModel));
      routingModel = fallbackModel;
      routingFallbackUsed = true;
    } catch (fallbackError) {
      console.error(`Language routing fallback model failed (${fallbackModel}); using original query`, fallbackError);
    }
  }

  const routingMs = Math.round(performance.now() - start);

  // Both models failed: fail open exactly as before (original query, und).
  if (!output) {
    return {
      originalQuery: trimmedQuery,
      searchQuery: trimmedQuery,
      inputLanguageCode: "und",
      inputLanguageName: GENERIC_LANGUAGE_NAME,
      indexLanguage,
      indexLanguageName,
      translated: false,
      routingMs,
      routingFallbackUsed,
    };
  }

  const searchQuery = output.searchQuery.trim() || trimmedQuery;
  const inputLanguageCode = output.inputLanguageCode.trim() || "und";
  const inputLanguageName = output.inputLanguageName.trim() || GENERIC_LANGUAGE_NAME;

  return {
    originalQuery: trimmedQuery,
    searchQuery,
    inputLanguageCode,
    inputLanguageName,
    indexLanguage,
    indexLanguageName,
    translated:
      inputLanguageCode.toLowerCase() !== indexLanguage ||
      searchQuery.localeCompare(trimmedQuery, undefined, { sensitivity: "accent" }) !== 0,
    routingMs,
    routingModel,
    routingFallbackUsed,
  };
}
