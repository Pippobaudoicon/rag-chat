import { generateText, gateway, Output } from "ai";
import { z } from "zod";
import type { CorpusLanguage } from "@/lib/types";

const DEFAULT_CHAT_MODEL = "deepseek/deepseek-v4-flash";

const CORPUS_LANGUAGE_NAMES: Record<CorpusLanguage, string> = {
  ita: "Italian",
  eng: "English",
};

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
  const configured = process.env.RAG_INDEX_LANGUAGE?.trim().toLowerCase();
  return configured === "eng" ? "eng" : "ita";
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
