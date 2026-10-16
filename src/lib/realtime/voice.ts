import { tool } from "ai";
import { z } from "zod";
import { runSemanticRetrieval } from "@/lib/rag/tools/shared/semantic-retrieval";
import { getIndexLanguage } from "@/lib/rag/language-routing";
import { ALL_SOURCES } from "@/lib/types";
import type { SourceChunk } from "@/lib/types";

// Web voice prototype: the one tool the realtime model can call. Declared via
// the token route, executed here (server) through POST /api/realtime/tool.

const semanticSearchInput = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe("Search query written in English (the index language), keeping names and scripture references"),
  language: z.enum(["eng", "ita"]).describe("Scripture language: ita if the user speaks Italian, eng for anything else"),
});

export const voiceTools = { semantic_search: tool({
  description: "Search the LDS scriptures, conference talks, handbook, study helps and gospel topics. Returns short passages with their references.",
  inputSchema: semanticSearchInput,
}) };

const TEXT_LIMIT = 600;
const TOP_K = 6;

const toSpeechResult = (c: SourceChunk) => ({
  reference:
    [c.title, c.speaker, c.book && `${c.book} ${c.chapter ?? ""}${c.verse ? `:${c.verse}` : ""}`.trim(), c.date]
      .filter(Boolean)
      .join(", ") || c.source,
  text: c.text.length > TEXT_LIMIT ? `${c.text.slice(0, TEXT_LIMIT)}…` : c.text,
});

/** Runs the voice `semantic_search` tool. Throws a ZodError on bad input. */
export async function runVoiceSemanticSearch(input: unknown) {
  const { query, language } = semanticSearchInput.parse(input);
  const { chunks } = await runSemanticRetrieval({
    query,
    sources: ALL_SOURCES,
    topK: TOP_K,
    language: getIndexLanguage(),
    scriptureLanguage: language,
  });
  return { results: chunks.slice(0, TOP_K).map(toSpeechResult) };
}
