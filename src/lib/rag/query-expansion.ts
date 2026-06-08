// Multi-query expansion: turn one query into a few semantically distinct
// phrasings so topical retrieval fans out across more of the candidate space
// before reranking. Gated behind RAG_MULTI_QUERY; see flags.ts.

import { generateText, gateway, Output } from "ai";
import { z } from "zod";

const DEFAULT_CHAT_MODEL = "deepseek/deepseek-v4-flash";

// Number of ALTERNATIVE phrasings requested (the original query is always kept,
// so total fan-out is at most MAX_VARIANTS + 1).
const MAX_VARIANTS = 2;

const variantsSchema = z.object({
  variants: z
    .array(z.string().min(1))
    .max(MAX_VARIANTS)
    .describe("Alternative phrasings of the query for retrieval."),
});

/**
 * Generate up to {@link MAX_VARIANTS} alternative phrasings of `query` (one in
 * canonical LDS/scriptural terminology, one in plainer wording) for retrieval
 * fan-out. Variants are written in `languageName` (the index language).
 *
 * Returns `[]` on any error or if the model echoes the original, so retrieval
 * cleanly falls back to the single original query.
 */
export async function generateQueryVariants(
  query: string,
  languageName: string,
  model: string = process.env.CHAT_MODEL ?? DEFAULT_CHAT_MODEL
): Promise<string[]> {
  const trimmed = query.trim();
  try {
    const result = await generateText({
      model: gateway(model),
      system: [
        "You expand an LDS (Latter-day Saint) search query into alternative phrasings for document retrieval.",
        `Write every variant in ${languageName}.`,
        "Produce semantically distinct rewordings: one using canonical LDS / scriptural terminology, one in plainer everyday wording.",
        "Preserve scripture references, names, titles, and years. Do not answer the question.",
      ].join("\n"),
      prompt: `Query:\n${trimmed}`,
      maxOutputTokens: 200,
      output: Output.object({ schema: variantsSchema }),
    });

    return (result.output.variants ?? [])
      .map((variant) => variant.trim())
      .filter(
        (variant) =>
          variant.length > 0 && variant.toLowerCase() !== trimmed.toLowerCase()
      )
      .slice(0, MAX_VARIANTS);
  } catch (error) {
    console.error("Query expansion failed; using original query only", error);
    return [];
  }
}
