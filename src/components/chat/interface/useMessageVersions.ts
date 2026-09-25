"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIMessage } from "ai";

import {
  assistantVersionsByPosition,
  withRegeneratedVersion,
} from "@/lib/chat/client-lifecycle";
import type { AssistantVersion, MessageMetadata, SourceChunk } from "@/lib/types";

import { getPlainText } from "../chat-utils";

const NO_VERSIONS: Record<string, AssistantVersion[]> = {};

function getLastAssistantMessageIndex(messages: UIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") return i;
  }
  return -1;
}

/**
 * Answer versions (one per regeneration) and which one each message shows.
 * Stored versions come by message id, falling back to position for messages
 * whose id changed on the client. A regeneration started with
 * `beginRegeneration` is recorded as a new version once streaming ends.
 */
export function useMessageVersions({
  messages,
  isStreaming,
  initialMessageVersions,
  initialAssistantVersions,
}: {
  messages: UIMessage[];
  isStreaming: boolean;
  initialMessageVersions: Record<string, AssistantVersion[]>;
  initialAssistantVersions: AssistantVersion[][];
}) {
  const [messageVersions, setMessageVersions] =
    useState<Record<string, AssistantVersion[]>>(initialMessageVersions);
  const [selectedVersionIndex, setSelectedVersionIndex] = useState<Record<string, number>>({});
  const storedVersionsByPosition = useMemo(
    () =>
      initialAssistantVersions.length === 0
        ? NO_VERSIONS
        : assistantVersionsByPosition(messages, initialAssistantVersions),
    [initialAssistantVersions, messages]
  );
  const pendingRegenerationRef = useRef<
    | {
        targetMessageId: string;
        previousVersion: AssistantVersion;
      }
    | null
  >(null);

  const versionsFor = (messageId: string): AssistantVersion[] | undefined =>
    messageVersions[messageId] ?? storedVersionsByPosition[messageId];

  /** The version a message shows: the one picked, else the latest. */
  const activeVersionIndexFor = (messageId: string): number | undefined => {
    const selected = selectedVersionIndex[messageId];
    if (selected !== undefined) return selected;
    const versions = versionsFor(messageId);
    return versions ? Math.max(versions.length - 1, 0) : undefined;
  };

  const selectVersion = useCallback((messageId: string, index: number) => {
    setSelectedVersionIndex((prev) => ({ ...prev, [messageId]: index }));
  }, []);

  const beginRegeneration = useCallback(
    (targetMessageId: string, previousVersion: AssistantVersion) => {
      pendingRegenerationRef.current = { targetMessageId, previousVersion };
    },
    []
  );

  const resetVersions = useCallback(() => {
    pendingRegenerationRef.current = null;
    setMessageVersions({});
    setSelectedVersionIndex({});
  }, []);

  useEffect(() => {
    const pending = pendingRegenerationRef.current;
    if (!pending || isStreaming) return;

    let targetMessage = messages.find(
      (msg) => msg.id === pending.targetMessageId && msg.role === "assistant"
    );

    if (!targetMessage) {
      const fallbackIndex = getLastAssistantMessageIndex(messages);
      if (fallbackIndex >= 0) {
        targetMessage = messages[fallbackIndex];
      }
    }

    if (!targetMessage || targetMessage.role !== "assistant") {
      pendingRegenerationRef.current = null;
      return;
    }

    const newText = getPlainText(targetMessage);
    const newSources = ((targetMessage.metadata as MessageMetadata | undefined)?.sources ?? []) as SourceChunk[];
    if (!newText.trim()) {
      pendingRegenerationRef.current = null;
      return;
    }

    const messageId = targetMessage.id;
    let nextLength = 0;
    setMessageVersions((prev) => {
      const versions = withRegeneratedVersion(
        prev[messageId] ?? storedVersionsByPosition[messageId],
        pending.previousVersion,
        { text: newText, sources: newSources }
      );
      nextLength = versions.length;
      return { ...prev, [messageId]: versions };
    });
    setSelectedVersionIndex((prev) => {
      return { ...prev, [messageId]: Math.max(nextLength - 1, 0) };
    });

    pendingRegenerationRef.current = null;
  }, [isStreaming, messages, storedVersionsByPosition]);

  return {
    versionsFor,
    activeVersionIndexFor,
    selectVersion,
    beginRegeneration,
    resetVersions,
  };
}
