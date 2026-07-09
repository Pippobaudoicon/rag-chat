"use client";

import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import type { SourceChunk } from "@/lib/types";

export type FeedbackValue = "up" | "down";
export type FeedbackEntry = { value: FeedbackValue; comment: string | null };
type FeedbackComposerState = { messageId: string; value: FeedbackValue } | null;
type FeedbackFollowUpState = { messageId: string; value: FeedbackValue } | null;

export const FEEDBACK_FOLLOWUP_TIMEOUT_MS = 6000;
const FEEDBACK_FOLLOWUP_FADE_MS = 300;

export type MessageFeedback = ReturnType<typeof useMessageFeedback>;

/**
 * Owns the message-feedback state machine: thumbs up/down persistence, the
 * transient "add a note" follow-up (with its auto-dismiss timer), and the
 * comment composer. Extracted from ChatInterface so the render stays readable.
 */
export function useMessageFeedback(
  initialFeedbackByMessageId: Record<string, FeedbackEntry>,
  conversationIdRef: MutableRefObject<string | undefined>
) {
  const [feedbackByMessageId, setFeedbackByMessageId] =
    useState<Record<string, FeedbackEntry>>(initialFeedbackByMessageId);
  const [feedbackComposer, setFeedbackComposer] = useState<FeedbackComposerState>(null);
  const [feedbackFollowUp, setFeedbackFollowUp] = useState<FeedbackFollowUpState>(null);
  const [feedbackFollowUpRemainingMs, setFeedbackFollowUpRemainingMs] = useState(0);
  const [isFeedbackFollowUpClosing, setIsFeedbackFollowUpClosing] = useState(false);
  const [feedbackCommentDraft, setFeedbackCommentDraft] = useState("");
  const [submittingFeedbackId, setSubmittingFeedbackId] = useState<string | null>(null);

  const submitFeedback = useCallback(
    async (
      messageId: string,
      feedback: FeedbackValue,
      answerText: string,
      answerSources: SourceChunk[] | undefined,
      question: string | null,
      comment: string | null
    ) => {
      const convId = conversationIdRef.current;
      if (!convId || submittingFeedbackId === messageId) return;

      const numericMessageId = Number(messageId);

      try {
        setSubmittingFeedbackId(messageId);

        const response = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: convId,
            assistantMessageId: Number.isInteger(numericMessageId) ? numericMessageId : null,
            clientMessageId: messageId,
            feedback,
            comment,
            question,
            answerText,
            sources: answerSources ?? [],
          }),
        });

        if (!response.ok) {
          throw new Error(`Feedback request failed with status ${response.status}`);
        }

        setFeedbackByMessageId((prev) => ({
          ...prev,
          [messageId]: { value: feedback, comment },
        }));
      } catch (error) {
        console.error("Failed to submit feedback", error);
      } finally {
        setSubmittingFeedbackId((current) => (current === messageId ? null : current));
      }
    },
    [conversationIdRef, submittingFeedbackId]
  );

  useEffect(() => {
    if (!feedbackFollowUp) {
      setFeedbackFollowUpRemainingMs(0);
      setIsFeedbackFollowUpClosing(false);
      return;
    }

    setIsFeedbackFollowUpClosing(false);

    const endAt = Date.now() + FEEDBACK_FOLLOWUP_TIMEOUT_MS;
    setFeedbackFollowUpRemainingMs(FEEDBACK_FOLLOWUP_TIMEOUT_MS);

    const interval = window.setInterval(() => {
      setFeedbackFollowUpRemainingMs(Math.max(0, endAt - Date.now()));
    }, 100);

    let fadeTimer: number | undefined;
    const timer = window.setTimeout(() => {
      setIsFeedbackFollowUpClosing(true);
      setFeedbackFollowUpRemainingMs(0);
      fadeTimer = window.setTimeout(() => {
        setFeedbackFollowUp((current) =>
          current && current.messageId === feedbackFollowUp.messageId ? null : current
        );
      }, FEEDBACK_FOLLOWUP_FADE_MS);
    }, FEEDBACK_FOLLOWUP_TIMEOUT_MS);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timer);
      if (fadeTimer) {
        window.clearTimeout(fadeTimer);
      }
    };
  }, [feedbackFollowUp]);

  const reset = useCallback(() => {
    setFeedbackByMessageId({});
    setFeedbackComposer(null);
    setFeedbackFollowUp(null);
    setFeedbackFollowUpRemainingMs(0);
    setIsFeedbackFollowUpClosing(false);
    setFeedbackCommentDraft("");
  }, []);

  return {
    feedbackByMessageId,
    feedbackComposer,
    setFeedbackComposer,
    feedbackFollowUp,
    setFeedbackFollowUp,
    feedbackFollowUpRemainingMs,
    isFeedbackFollowUpClosing,
    feedbackCommentDraft,
    setFeedbackCommentDraft,
    submittingFeedbackId,
    submitFeedback,
    reset,
  };
}
