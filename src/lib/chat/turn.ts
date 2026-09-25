import type { ChatProgressData, MessageDetails, RetrievalToolEvent, SourceChunk } from "@/lib/types";

// Pure helpers for one POST /api/chat turn. Tested by `test:chat-turn`.

type StoredTurnMessage = { id: number; role: string; content: string };

/** Distinct tool names called across the model steps, in first-call order. */
export function getToolNames(
  steps: readonly { toolCalls?: readonly unknown[] }[]
): string[] {
  return [
    ...new Set(
      steps.flatMap((step) =>
        (step.toolCalls ?? []).flatMap((toolCall) => {
          if (!toolCall || typeof toolCall !== "object") return [];
          const { toolName } = toolCall as { toolName?: unknown };
          return typeof toolName === "string" && toolName.trim() ? [toolName] : [];
        })
      )
    ),
  ];
}

/** First occurrence of each chunk id, capped at `max`. */
export function uniqueSources(chunks: SourceChunk[], max: number): SourceChunk[] {
  return chunks
    .filter((chunk, idx, arr) => arr.findIndex((c) => c.id === chunk.id) === idx)
    .slice(0, max);
}

/**
 * The assistant message a regenerate request targets: `messageId` when it names
 * a stored assistant message, else the latest assistant message.
 */
export function findRegenerateTarget<T extends StoredTurnMessage>(
  storedMessages: T[],
  messageId: string | number | undefined
): T | null {
  if (messageId) {
    const numericMessageId = Number(messageId);
    if (!Number.isNaN(numericMessageId)) {
      const target = storedMessages.find(
        (msg) => msg.id === numericMessageId && msg.role === "assistant"
      );
      if (target) return target;
    }
  }
  return [...storedMessages].reverse().find((msg) => msg.role === "assistant") ?? null;
}

/** Index of the user message that the stored message `targetId` answers, or -1. */
export function userTurnIndexBefore(
  storedMessages: StoredTurnMessage[],
  targetId: number
): number {
  const targetIndex = storedMessages.findIndex((msg) => msg.id === targetId);
  for (let i = targetIndex - 1; i >= 0; i -= 1) {
    if (storedMessages[i].role === "user") return i;
  }
  return -1;
}

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  outputTokenDetails?: { reasoningTokens?: number };
};

/** Token counts for `MessageDetails` from an AI SDK usage object. */
export function usageDetails(
  usage: Usage
): Pick<MessageDetails, "inputTokens" | "outputTokens" | "totalTokens" | "reasoningTokens"> {
  return {
    inputTokens: usage.inputTokens ?? undefined,
    outputTokens: usage.outputTokens ?? undefined,
    totalTokens: usage.totalTokens ?? undefined,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? undefined,
  };
}

/** The retrieval-trace entry for a tool's terminal `tools` progress event. */
export function toRetrievalToolEvent(progress: ChatProgressData): RetrievalToolEvent {
  return {
    toolName: progress.toolName,
    sourceCount: progress.sourceCount,
    cacheHit: progress.cacheHit,
    elapsedMs: progress.elapsedMs,
    // Tool-local language routing (present for semantic_search /
    // search_conference_talks; absent for lookup_scripture_passage).
    routingMs: progress.routingMs,
    translated: progress.translated,
    inputLanguageCode: progress.inputLanguageCode,
    retrievalLanguage: progress.retrievalLanguage,
    routingModel: progress.routingModel,
    routingFallbackUsed: progress.routingFallbackUsed,
    routingCalls: progress.routingCalls,
  };
}
