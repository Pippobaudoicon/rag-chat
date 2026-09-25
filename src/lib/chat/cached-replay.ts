import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  type FinishReason,
} from "ai";
import type { MessageDetails, SourceChunk } from "@/lib/types";

// Streams a session-answer cache hit back as if it were being generated.

const CACHED_REPLAY_WORDS_PER_CHUNK = 3;
const CACHED_REPLAY_DELAY_MS = 16;

export function chunkCachedText(text: string): string[] {
  const words = text.match(/\S+\s*/g) ?? [];
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += CACHED_REPLAY_WORDS_PER_CHUNK) {
    chunks.push(words.slice(index, index + CACHED_REPLAY_WORDS_PER_CHUNK).join(""));
  }
  return chunks;
}

const waitForCachedReplay = (delayMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export function cachedAnswerResponse(
  text: string,
  metadata: { sources: SourceChunk[]; details: MessageDetails },
  finishReason: FinishReason | undefined
): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "start-step" });
      writer.write({ type: "text-start", id: "text-1" });
      const cachedChunks = chunkCachedText(text);
      for (let index = 0; index < cachedChunks.length; index += 1) {
        writer.write({
          type: "text-delta",
          id: "text-1",
          delta: cachedChunks[index],
        });
        if (index < cachedChunks.length - 1) {
          await waitForCachedReplay(CACHED_REPLAY_DELAY_MS);
        }
      }
      writer.write({ type: "text-end", id: "text-1" });
      writer.write({ type: "message-metadata", messageMetadata: metadata });
      writer.write({ type: "finish-step" });
      writer.write({
        type: "finish",
        finishReason,
        messageMetadata: metadata,
      });
    },
    generateId,
  });

  return createUIMessageStreamResponse({ stream });
}
