"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { UIMessage } from "ai";

import type { MessageMetadata } from "@/lib/types";

/**
 * Suggested next questions for the latest answer: the ones stored with it
 * (reloaded conversations) or the ones fetched right after it finished.
 */
export function useFollowUps() {
  const [fetched, setFetched] = useState<{ messageId: string; items: string[] } | null>(null);
  const requestRef = useRef(0);

  const loadFollowUps = useCallback(async (conversationId: string, messageId: string) => {
    const request = ++requestRef.current;
    try {
      const response = await fetch(`/api/conversations/${conversationId}/follow-ups`, {
        method: "POST",
      });
      if (!response.ok) return;
      const { followUps } = (await response.json()) as { followUps?: unknown };
      if (request === requestRef.current && Array.isArray(followUps)) {
        setFetched({ messageId, items: followUps.filter((q) => typeof q === "string") });
      }
    } catch {
      // Suggestions are optional; the chat works the same without them.
    }
  }, []);

  const resetFollowUps = useCallback(() => {
    requestRef.current += 1;
    setFetched(null);
  }, []);

  const followUpsFor = useCallback(
    (message: UIMessage | undefined): string[] => {
      if (message?.role !== "assistant") return [];
      if (fetched?.messageId === message.id) return fetched.items;
      return (message.metadata as MessageMetadata | undefined)?.details?.followUps ?? [];
    },
    [fetched]
  );

  return { followUpsFor, loadFollowUps, resetFollowUps };
}

const subscribePointer = (onChange: () => void) => {
  const query = window.matchMedia("(pointer: fine)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** True with a mouse/trackpad (desktop): suggestions go in the placeholder + Tab. */
export function usePointerFine() {
  return useSyncExternalStore(
    subscribePointer,
    () => window.matchMedia("(pointer: fine)").matches,
    () => false
  );
}

const TAB_USES_KEY = "chat:follow-up-tab-uses";
// After this many Tab accepts the hint drops its explanation and keeps the key.
const TAB_USES_TO_LEARN = 3;

/** Whether the user has learned the Tab shortcut (per browser). */
export function useTabShortcutLearned() {
  const [uses, setUses] = useState(0);

  // Read after mount so SSR and the first client render agree.
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(TAB_USES_KEY)) || 0;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from localStorage after mount
      if (stored) setUses(stored);
    } catch {
      // ignore
    }
  }, []);

  const recordTabUse = useCallback(() => {
    setUses((current) => {
      const next = current + 1;
      try {
        localStorage.setItem(TAB_USES_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { learned: uses >= TAB_USES_TO_LEARN, recordTabUse };
}
