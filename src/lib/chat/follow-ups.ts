// Suggested next questions shown under the composer after an answer. Generated
// by a small separate model call once the answer is saved, so they never delay
// the answer itself; see POST /api/conversations/[id]/follow-ups.

import { generateText, gateway, Output } from "ai";
import { z } from "zod";

// A small, fast, non-reasoning multilingual model: three short questions need
// no more. Pinned here rather than read from CHAT_MODEL, so a pricier chat
// model doesn't raise this cost.
const DEFAULT_FOLLOW_UP_MODEL = "google/gemini-2.5-flash-lite";
const FOLLOW_UP_MODEL = process.env.FOLLOW_UP_MODEL?.trim() || DEFAULT_FOLLOW_UP_MODEL;
// Suggestions arriving later than this are no longer useful; give up instead.
const FOLLOW_UP_TIMEOUT_MS = 10_000;

export const MAX_FOLLOW_UPS = 3;
export const MAX_FOLLOW_UP_LENGTH = 120;
// Only the answer's opening matters for picking next questions; keeps the call cheap.
const MAX_ANSWER_CHARS = 2500;

const followUpsSchema = z.object({
  questions: z.array(z.string()).max(6),
});

/**
 * Clean model output into at most {@link MAX_FOLLOW_UPS} short, distinct
 * questions: trims list markers and quotes, drops empty, over-long, or repeated
 * entries and any that just repeat the user's question.
 */
export function normalizeFollowUps(raw: unknown, question = ""): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set([question.trim().toLowerCase()]);
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const text = item
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
      .replace(/^["'“«]+|["'”»]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const key = text.toLowerCase();
    if (!text || text.length > MAX_FOLLOW_UP_LENGTH || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length === MAX_FOLLOW_UPS) break;
  }
  return result;
}

/** Suggest next questions for a finished turn. Returns `[]` on any error. */
export async function generateFollowUps(
  question: string,
  answer: string
): Promise<string[]> {
  try {
    const result = await generateText({
      model: gateway(FOLLOW_UP_MODEL),
      system: [
        "You suggest what a user might ask next in a chat about the teachings of The Church of Jesus Christ of Latter-day Saints.",
        `Write ${MAX_FOLLOW_UPS} short follow-up questions (under 80 characters each) the USER could send next, in the user's voice.`,
        "Write them in the same language as the user's question.",
        "Make them distinct: e.g. go deeper on one point, ask for a scripture or talk, ask how to apply it.",
        "Do not repeat the user's question and do not answer anything.",
      ].join("\n"),
      prompt: `User question:\n${question.trim()}\n\nAssistant answer:\n${answer.trim().slice(0, MAX_ANSWER_CHARS)}`,
      maxOutputTokens: 300,
      abortSignal: AbortSignal.timeout(FOLLOW_UP_TIMEOUT_MS),
      output: Output.object({ schema: followUpsSchema }),
    });
    return normalizeFollowUps(result.output.questions, question);
  } catch (error) {
    console.error("Follow-up suggestion generation failed", error);
    return [];
  }
}
