import { generateText, gateway, Output } from "ai";
import { detectAll } from "tinyld";
import { z } from "zod";
import type { CorpusLanguage } from "@/lib/types";

const DEFAULT_CHAT_MODEL = "deepseek/deepseek-v4-flash";

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
    model?: string;
  } = {}
): Promise<QueryLanguageRouting> {
  const indexLanguage = options.indexLanguage ?? getIndexLanguage();
  const indexLanguageName = getCorpusLanguageName(indexLanguage);
  const trimmedQuery = query.trim();

  // Local same-language fast-path. When the prompt is confidently, dominantly
  // in the index language, translation is identity and the routing LLM call is
  // pure latency/cost — so skip `generateText`. Mixed/quoted-language prompts
  // and cross-language prompts (e.g. Italian → English index) fall through to
  // the LLM so translation and answer-language fidelity are preserved.
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
    };
  }

  try {
    const result = await generateText({
      model: gateway(options.model ?? process.env.CHAT_MODEL ?? DEFAULT_CHAT_MODEL),
      system: [
        "You detect the language of LDS search prompts and translate them for retrieval.",
        `The Pinecone index language is ${indexLanguageName}.`,
        "Return only structured data. Do not answer the question.",
        "Preserve scripture references, names, titles, speakers, and years.",
        "When a scripture book has a standard name in the index language, use that name.",
        "If the prompt is already in the index language, keep the search query semantically identical.",
      ].join("\n"),
      prompt: `User prompt:\n${trimmedQuery}`,
      maxOutputTokens: 600,
      output: Output.object({ schema: languageRoutingSchema }),
    });

    const output = result.output;
    const searchQuery = output.searchQuery.trim() || trimmedQuery;
    const inputLanguageCode = output.inputLanguageCode.trim() || "und";
    const inputLanguageName = output.inputLanguageName.trim() || "the user's language";

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
    };
  } catch (error) {
    console.error("Language routing failed; using original query for retrieval", error);
    return {
      originalQuery: trimmedQuery,
      searchQuery: trimmedQuery,
      inputLanguageCode: "und",
      inputLanguageName: "the user's language",
      indexLanguage,
      indexLanguageName,
      translated: false,
    };
  }
}
