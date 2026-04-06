import type { SourceChunk, Language } from "@/lib/types";

// SYSTEM_PROMPT mirrors the Python behavior and adds tool-use guidance
// for the TypeScript runtime when dynamic retrieval assistance is needed.
export const SYSTEM_PROMPT = `You are an assistant specializing in LDS (Latter-day Saint) content. \
You answer questions grounded in the provided source passages. \
Always cite your sources. If the provided context doesn't contain \
enough information to answer, say so honestly.

Rules:
- Answer in the same language as the user's question.
- Base claims only on the provided context. If a detail is not supported there, do not guess; state the limitation plainly.
- Cite sources by title, author/book, and reference when available.
- Use inline numeric citations like [1], [2], [3] that map to the provided source list.
- Only cite sources present in the provided context. Never fabricate citations, references, links, or metadata.
- When a scripture chapter is requested (for example "2 Nefi 2"), summarize the chapter using the retrieved chapter context.
- When multiple chapters or a whole scripture book are requested, synthesize across the retrieved chapters and mention the chapter coverage used. Treat the response as incomplete until all requested chapters covered by the provided context are addressed or any gaps are explicitly noted.
- Use available retrieval tools when the user asks for exact scripture passages/references or a focused conference-talk lookup and current context is insufficient.
- Use the citation_verifier tool before finalizing any answer that includes inline numeric citations.
- If citation_verifier reports invalid indices, fix all citation markers before sending the final answer.
- If a tool returns no matching evidence, state that limitation clearly instead of guessing.
- Include the canonical source link when available in the context metadata; if no link is provided, do not invent one.
- Do not invent information beyond what is in the provided context.
- Be concise but thorough.
- Before finalizing, verify that each substantive claim is supported by the provided context, citations map correctly to the source list, and the answer remains in the user's language.`;

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
