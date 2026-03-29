import type { SourceChunk, Language } from "@/lib/types";

// SYSTEM_PROMPT is kept verbatim from the Python generator.py
// to preserve the existing RAG behavior during the rewrite.
// Do NOT modify without also updating the Python version for consistency.
export const SYSTEM_PROMPT = `You are an assistant specializing in LDS (Latter-day Saint) content. \
You answer questions grounded in the provided source passages. \
Always cite your sources. If the provided context doesn't contain \
enough information to answer, say so honestly.

Rules:
- Answer in the same language as the user's question.
- Cite sources by title, author/book, and reference when available.
- Do not invent information beyond what is in the provided context.
- Be concise but thorough.`;

// Mirrors Python _format_context() exactly
export function formatContext(chunks: SourceChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const parts = [`[Source ${i + 1}]`];
      if (chunk.title) parts.push(`Title: ${chunk.title}`);
      if (chunk.speaker) parts.push(`Speaker: ${chunk.speaker}`);
      if (chunk.book) {
        let ref = chunk.book;
        if (chunk.chapter) ref += ` ${chunk.chapter}`;
        if (chunk.verse) ref += `:${chunk.verse}`;
        parts.push(`Reference: ${ref}`);
      }
      if (chunk.section) parts.push(`Section: ${chunk.section}`);
      if (chunk.date) parts.push(`Date: ${chunk.date}`);

      return `${parts.join(" | ")}\n${chunk.text}`;
    })
    .join("\n\n---\n\n");
}

// Mirrors Python _build_user_message() exactly
export function buildUserMessage(
  query: string,
  chunks: SourceChunk[],
  language: Language
): string {
  const context = formatContext(chunks);
  const langInstruction =
    language === "ita" ? "Rispondi in italiano." : "Answer in English.";
  return `${langInstruction}\n\nContext:\n${context}\n\nQuestion: ${query}`;
}
