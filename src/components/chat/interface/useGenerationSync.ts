"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatStatus } from "ai";
import { useRouter } from "next/navigation";

import {
  CHAT_GENERATION_CLAIM_TIMEOUT_MS,
  shouldFailGenerationClaim,
} from "@/lib/chat/client-lifecycle";
import type { ChatGenerationStatus, ChatProgressData } from "@/lib/types";

type GenerationClaim = {
  /** A request was sent; the server has not confirmed it owns the turn yet. */
  pending: boolean;
  startedAt: number | null;
  transportError: boolean;
};

const SETTLED_CLAIM: GenerationClaim = {
  pending: false,
  startedAt: null,
  transportError: false,
};

/**
 * The conversation's generation state on the client: the persisted status,
 * the live progress, and whether a sent request is still waiting for the
 * server to claim it. Kept in sync by `useGenerationSync`.
 */
export function useGenerationState(initialGenerationStatus: ChatGenerationStatus) {
  const [chatProgress, setChatProgress] = useState<ChatProgressData | null>(null);
  const [generationStatus, setGenerationStatus] =
    useState<ChatGenerationStatus>(initialGenerationStatus);
  const claimRef = useRef<GenerationClaim>(SETTLED_CLAIM);
  const resumeInFlightRef = useRef(false);
  const resumeAllowedRef = useRef(initialGenerationStatus === "streaming");

  const beginClaim = useCallback(() => {
    claimRef.current = { pending: true, startedAt: Date.now(), transportError: false };
  }, []);

  const settleClaim = useCallback(() => {
    claimRef.current = SETTLED_CLAIM;
  }, []);

  const markTransportError = useCallback(() => {
    claimRef.current = { ...claimRef.current, transportError: true };
  }, []);

  const markGenerationClaimError = useCallback(() => {
    claimRef.current = SETTLED_CLAIM;
    setGenerationStatus("error");
    setChatProgress(null);
    window.dispatchEvent(new CustomEvent("chat:conversations-changed"));
  }, []);

  /** Back to a blank chat. */
  const resetGeneration = useCallback(() => {
    resumeInFlightRef.current = false;
    resumeAllowedRef.current = false;
    claimRef.current = SETTLED_CLAIM;
    setChatProgress(null);
    setGenerationStatus("idle");
  }, []);

  return {
    chatProgress,
    setChatProgress,
    generationStatus,
    setGenerationStatus,
    claimRef,
    resumeInFlightRef,
    resumeAllowedRef,
    beginClaim,
    settleClaim,
    markTransportError,
    markGenerationClaimError,
    resetGeneration,
  };
}

/**
 * Keeps `useGenerationState` in sync while the generation is `streaming`:
 * polls the status endpoint, resumes the Redis stream when the page opened on
 * an active generation, reloads the page once the generation ends, and fails
 * a request the server never claimed.
 */
export function useGenerationSync(
  {
    setChatProgress,
    generationStatus,
    setGenerationStatus,
    claimRef,
    resumeInFlightRef,
    resumeAllowedRef,
    markGenerationClaimError,
  }: ReturnType<typeof useGenerationState>,
  {
    conversationId,
    chatStatus,
    initialGenerationStatus,
    resumeStreamEnabled,
    resumeStream,
  }: {
    conversationId: string | undefined;
    chatStatus: ChatStatus;
    initialGenerationStatus: ChatGenerationStatus;
    resumeStreamEnabled: boolean;
    resumeStream: () => Promise<void>;
  }
) {
  const router = useRouter();
  const chatStatusRef = useRef(chatStatus);
  useEffect(() => {
    chatStatusRef.current = chatStatus;
  }, [chatStatus]);

  // The SDK is done with the turn: drop its progress (adjusted during render
  // rather than in an effect).
  const [renderedChatStatus, setRenderedChatStatus] = useState(chatStatus);
  if (chatStatus !== renderedChatStatus) {
    setRenderedChatStatus(chatStatus);
    if (chatStatus === "ready") setChatProgress(null);
  }

  useEffect(() => {
    if (!conversationId || generationStatus !== "streaming") return;

    let cancelled = false;
    let timer: number | undefined;

    const synchronizeGeneration = async () => {
      let shouldPollAgain = true;
      try {
        const response = await fetch(
          `/api/conversations/${conversationId}?status=1`,
          { cache: "no-store" }
        );
        if (!response.ok) return;

        const payload = (await response.json()) as {
          generationStatus: ChatGenerationStatus;
        };
        if (cancelled) return;

        if (payload.generationStatus === "streaming") {
          claimRef.current = SETTLED_CLAIM;
          setGenerationStatus("streaming");

          if (
            initialGenerationStatus === "streaming" &&
            resumeStreamEnabled &&
            resumeAllowedRef.current &&
            chatStatusRef.current === "ready" &&
            !resumeInFlightRef.current
          ) {
            resumeInFlightRef.current = true;
            try {
              await resumeStream();
            } finally {
              resumeInFlightRef.current = false;
              if (!cancelled) router.refresh();
            }
          }
          return;
        }

        if (claimRef.current.pending) {
          const claimFailed = shouldFailGenerationClaim(
            claimRef.current.startedAt,
            claimRef.current.transportError
          );
          if (!claimFailed) {
            // The status can still reflect the preceding turn while /api/chat
            // is completing its authenticated generation claim.
            setGenerationStatus("streaming");
            return;
          }

          shouldPollAgain = false;
          markGenerationClaimError();
          return;
        }

        setGenerationStatus(payload.generationStatus);
        shouldPollAgain = false;
        window.dispatchEvent(new CustomEvent("chat:conversations-changed"));
        router.refresh();
      } catch (error) {
        console.error("Failed to synchronize active chat generation", error);
      } finally {
        if (!cancelled && shouldPollAgain) {
          timer = window.setTimeout(synchronizeGeneration, 2000);
        }
      }
    };

    void synchronizeGeneration();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    initialGenerationStatus,
    generationStatus,
    conversationId,
    resumeStream,
    resumeStreamEnabled,
    router,
    markGenerationClaimError,
    claimRef,
    resumeAllowedRef,
    resumeInFlightRef,
    setGenerationStatus,
  ]);

  useEffect(() => {
    const startedAt = claimRef.current.startedAt;
    if (
      !conversationId ||
      generationStatus !== "streaming" ||
      !claimRef.current.pending ||
      startedAt === null
    ) {
      return;
    }

    const remainingMs = Math.max(
      0,
      CHAT_GENERATION_CLAIM_TIMEOUT_MS - (Date.now() - startedAt)
    );
    const timer = window.setTimeout(() => {
      if (claimRef.current.pending) markGenerationClaimError();
    }, remainingMs);
    return () => window.clearTimeout(timer);
  }, [markGenerationClaimError, generationStatus, conversationId, claimRef]);
}
