"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { UIMessage } from "ai";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  InfoIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageToolbar,
  MessageAction,
} from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SourcesPanel } from "./SourcesPanel";
import { DetailRows } from "./DetailsPanel";
import { linkifyInlineCitations } from "@/lib/rag/citation-links";
import { parseScriptureSelection } from "@/lib/rag/scripture-reference";
import { uiText } from "./i18n";
import type {
  AssistantVersion,
  ChatProgressData,
  MessageMetadata,
  SourceChunk,
  UiLanguage,
} from "@/lib/types";
import {
  AssistantActivityIndicator,
  getToolUsage,
  isTextPart,
} from "./chat-utils";
import type { ChatStatus, PendingPhase } from "./chat-utils";
import {
  FEEDBACK_FOLLOWUP_TIMEOUT_MS,
  type MessageFeedback,
} from "./useMessageFeedback";

const STREAM_IDLE_INDICATOR_DELAY_MS = 900;

interface ChatMessageProps {
  message: UIMessage;
  previousUserQuery: string | null;
  isActiveAssistantMessage: boolean;
  language: UiLanguage;
  isStreaming: boolean;
  status: ChatStatus;
  chatProgress: ChatProgressData | null;
  copiedId: string | null;
  expandedDetailsId: string | null;
  conversationIdRef: MutableRefObject<string | undefined>;
  /** Regenerated in-session versions for this message, if any. */
  versionsOverride?: AssistantVersion[];
  /** Active version index for this message, if the user has navigated. */
  activeVersionIndex?: number;
  feedback: MessageFeedback;
  onSelectVersion: (messageId: string, index: number) => void;
  onToggleDetails: (messageId: string) => void;
  onCopy: (id: string, text: string) => void;
  onRegenerate: (
    messageId: string,
    question: string,
    currentText: string,
    fixedChunks: SourceChunk[]
  ) => void;
}

export function ChatMessage({
  message,
  previousUserQuery,
  isActiveAssistantMessage,
  language,
  isStreaming,
  status,
  chatProgress,
  copiedId,
  expandedDetailsId,
  conversationIdRef,
  versionsOverride,
  activeVersionIndex,
  feedback,
  onSelectVersion,
  onToggleDetails,
  onCopy,
  onRegenerate,
}: ChatMessageProps) {
  const text = uiText(language);

  const textParts = message.parts.filter(isTextPart);
  const messageText = textParts.map((part) => part.text).join("\n\n");
  const hasText = messageText.trim().length > 0;
  const hasToolUsage = getToolUsage(message).length > 0;
  // Extract sources from message metadata if available
  const metadata = message.metadata as MessageMetadata | undefined;
  const messageSources = metadata?.sources;
  const messageDetails = metadata?.details;
  const persistedVersions = metadata?.versions ?? [];
  const versions = versionsOverride ?? persistedVersions;
  const hasVersions = versions.length > 1;
  const currentVersionIndex = hasVersions
    ? Math.min(activeVersionIndex ?? versions.length - 1, versions.length - 1)
    : 0;
  const displayedText = hasVersions ? versions[currentVersionIndex].text : messageText;
  const displayedSources = hasVersions ? versions[currentVersionIndex].sources : messageSources;
  const shouldShowScriptureCoverage =
    message.role === "assistant" &&
    !!previousUserQuery &&
    !!parseScriptureSelection(previousUserQuery, language === "ita" ? "ita" : "eng");
  const isAssistantActive =
    message.role === "assistant" &&
    isActiveAssistantMessage &&
    isStreaming &&
    status !== "submitted";
  const [streamHasPaused, setStreamHasPaused] = useState(false);
  const [toolStatusVisible, setToolStatusVisible] = useState(false);
  const toolCompletionTextRef = useRef("");
  const latestMessageTextRef = useRef(messageText);
  latestMessageTextRef.current = messageText;

  useEffect(() => {
    if (!isAssistantActive) {
      setStreamHasPaused(false);
      return;
    }
    if (!hasText) {
      setStreamHasPaused(true);
      return;
    }

    setStreamHasPaused(false);
    const timeout = window.setTimeout(
      () => setStreamHasPaused(true),
      STREAM_IDLE_INDICATOR_DELAY_MS
    );
    return () => window.clearTimeout(timeout);
  }, [hasText, isAssistantActive, messageText]);

  useEffect(() => {
    if (!isAssistantActive || chatProgress?.toolCompleted !== true) {
      setToolStatusVisible(false);
      return;
    }

    toolCompletionTextRef.current = latestMessageTextRef.current;
    setToolStatusVisible(true);
  }, [chatProgress, isAssistantActive]);

  useEffect(() => {
    if (
      toolStatusVisible &&
      toolCompletionTextRef.current !== messageText
    ) {
      setToolStatusVisible(false);
    }
  }, [messageText, toolStatusVisible]);
  const selectedFeedback = feedback.feedbackByMessageId[message.id];
  const isComposerOpenForMessage = feedback.feedbackComposer?.messageId === message.id;
  const isFollowUpOpenForMessage =
    feedback.feedbackFollowUp?.messageId === message.id && !isComposerOpenForMessage;
  const isSubmittingFeedback = feedback.submittingFeedbackId === message.id;
  const followUpSeconds = Math.max(0, Math.ceil(feedback.feedbackFollowUpRemainingMs / 1000));
  const followUpProgressPct = Math.max(
    0,
    Math.min(100, (feedback.feedbackFollowUpRemainingMs / FEEDBACK_FOLLOWUP_TIMEOUT_MS) * 100)
  );
  const pendingPhase: PendingPhase =
    chatProgress && chatProgress.phase !== "complete"
      ? chatProgress.phase
      : status === "submitted"
      ? "queued"
      : hasToolUsage
        ? "tools"
        : "drafting";
  const phaseNeedsAttention = pendingPhase === "sources" || pendingPhase === "tools";
  const showActivity =
    isAssistantActive &&
    (!hasText || phaseNeedsAttention || toolStatusVisible || streamHasPaused);

  return (
    <Message from={message.role}>
      <MessageContent>
        {hasVersions ? (
          <MessageResponse>{linkifyInlineCitations(displayedText, displayedSources)}</MessageResponse>
        ) : (
          textParts.map((part, index) => (
            <MessageResponse key={`${message.id}-${index}`}>
              {linkifyInlineCitations(part.text, messageSources)}
            </MessageResponse>
          ))
        )}
        {showActivity && (
          <AssistantActivityIndicator
            language={language}
            phase={pendingPhase}
            afterTool={toolStatusVisible}
            className="mt-1"
          />
        )}
        {/* Action toolbar under response */}
        {hasText && message.role === "assistant" && !isAssistantActive && (
          <MessageToolbar className="justify-start gap-1.5">
            {hasVersions && (
              <>
                <MessageAction
                  tooltip={text.chat.previousVersion}
                  size="sm"
                  disabled={currentVersionIndex === 0}
                  className="cursor-pointer px-2 text-xs text-muted-foreground"
                  onClick={() => {
                    onSelectVersion(message.id, Math.max(0, currentVersionIndex - 1));
                  }}
                >
                  <ChevronLeftIcon size={14} />
                </MessageAction>
                <span className="px-1 text-xs text-muted-foreground">
                  {currentVersionIndex + 1}/{versions.length}
                </span>
                <MessageAction
                  tooltip={text.chat.nextVersion}
                  size="sm"
                  disabled={currentVersionIndex >= versions.length - 1}
                  className="cursor-pointer px-2 text-xs text-muted-foreground"
                  onClick={() => {
                    onSelectVersion(message.id, Math.min(versions.length - 1, currentVersionIndex + 1));
                  }}
                >
                  <ChevronRightIcon size={14} />
                </MessageAction>
              </>
            )}
            <MessageAction
              tooltip={text.chat.helpful}
              size="sm"
              disabled={isSubmittingFeedback || !conversationIdRef.current}
              className={`cursor-pointer gap-1.5 px-2 text-xs ${
                selectedFeedback?.value === "up"
                  ? "text-emerald-400"
                  : "text-muted-foreground"
              }`}
              onClick={() => {
                feedback.setFeedbackComposer(null);
                feedback.setFeedbackFollowUp({ messageId: message.id, value: "up" });
                feedback.setFeedbackCommentDraft("");
                void feedback.submitFeedback(
                  message.id,
                  "up",
                  displayedText,
                  displayedSources,
                  previousUserQuery,
                  null
                );
              }}
            >
              <ThumbsUpIcon size={14} />
            </MessageAction>
            <MessageAction
              tooltip={text.chat.unhelpful}
              size="sm"
              disabled={isSubmittingFeedback || !conversationIdRef.current}
              className={`cursor-pointer gap-1.5 px-2 text-xs ${
                selectedFeedback?.value === "down"
                  ? "text-rose-400"
                  : "text-muted-foreground"
              }`}
              onClick={() => {
                feedback.setFeedbackComposer(null);
                feedback.setFeedbackFollowUp({ messageId: message.id, value: "down" });
                feedback.setFeedbackCommentDraft("");
                void feedback.submitFeedback(
                  message.id,
                  "down",
                  displayedText,
                  displayedSources,
                  previousUserQuery,
                  null
                );
              }}
            >
              <ThumbsDownIcon size={14} />
            </MessageAction>
            <MessageAction
              tooltip={text.chat.copyMessage}
              size="sm"
              className="cursor-pointer gap-1.5 px-2 text-xs text-muted-foreground"
              onClick={() => {
                void onCopy(message.id, displayedText);
              }}
            >
              {copiedId === message.id ? (
                <>
                  <CheckIcon size={14} />
                  <span>{text.chat.copied}</span>
                </>
              ) : (
                <CopyIcon size={14} />
              )}
            </MessageAction>
            <MessageAction
              tooltip={text.chat.regenerate}
              size="sm"
              disabled={
                isStreaming || !previousUserQuery || !displayedSources || displayedSources.length === 0
              }
              className="cursor-pointer gap-1.5 px-2 text-xs text-muted-foreground"
              onClick={() => {
                if (!previousUserQuery || !displayedSources || displayedSources.length === 0) {
                  return;
                }
                void onRegenerate(message.id, previousUserQuery, displayedText, displayedSources);
              }}
            >
              <RefreshCwIcon size={14} />
            </MessageAction>
            {messageDetails && (
              <MessageAction
                tooltip={text.chat.details}
                size="sm"
                className={`cursor-pointer gap-1.5 px-2 text-xs ${
                  expandedDetailsId === message.id
                    ? "text-indigo-400"
                    : "text-muted-foreground"
                }`}
                onClick={() => {
                  onToggleDetails(message.id);
                }}
              >
                <InfoIcon size={14} />
              </MessageAction>
            )}
          </MessageToolbar>
        )}
        {hasText && message.role === "assistant" && messageDetails && expandedDetailsId === message.id && (
          <div className="mt-1.5 rounded-md border border-border/40 bg-background/30 px-3 py-2">
            <DetailRows details={messageDetails} language={language} />
          </div>
        )}
        {hasText && message.role === "assistant" && isFollowUpOpenForMessage && (
          <div
            className={`mt-1 rounded-md border border-border/40 bg-background/30 px-2 py-1.5 text-[11px] text-muted-foreground/85 transition-all duration-300 ${
              feedback.isFeedbackFollowUpClosing ? "translate-y-1 opacity-0" : "translate-y-0 opacity-100"
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span>
                {feedback.feedbackFollowUp?.value === "down"
                  ? text.chat.addReason
                  : text.chat.addNote}
              </span>
              <span className="tabular-nums text-[10px] text-muted-foreground/60">
                {followUpSeconds}s
              </span>
            </div>
            <div className="mb-1.5 h-1 w-full overflow-hidden rounded-full bg-muted/25">
              <div
                className="h-full rounded-full bg-muted-foreground/40 transition-[width] duration-100 ease-linear"
                style={{ width: `${followUpProgressPct}%` }}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="h-5 px-1.5 text-[10px]"
                onClick={() => {
                  if (!feedback.feedbackFollowUp) return;
                  feedback.setFeedbackComposer({
                    messageId: message.id,
                    value: feedback.feedbackFollowUp.value,
                  });
                  feedback.setFeedbackFollowUp(null);
                  feedback.setFeedbackCommentDraft(selectedFeedback?.comment ?? "");
                }}
              >
                {text.chat.add}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="h-5 px-1.5 text-[10px]"
                onClick={() => {
                  feedback.setFeedbackFollowUp(null);
                }}
              >
                {text.chat.dismiss}
              </Button>
            </div>
          </div>
        )}
        {hasText && message.role === "assistant" && isComposerOpenForMessage && (
          <div className="mt-2 rounded-md border border-border/60 bg-background/60 p-2.5">
            <p className="mb-2 text-xs text-muted-foreground">
              {feedback.feedbackComposer?.value === "up"
                ? text.chat.helpfulCommentPrompt
                : text.chat.unhelpfulCommentPrompt}
            </p>
            <Textarea
              value={feedback.feedbackCommentDraft}
              onChange={(event) => feedback.setFeedbackCommentDraft(event.target.value)}
              placeholder={text.chat.commentPlaceholder}
              className="min-h-20"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  feedback.setFeedbackComposer(null);
                  feedback.setFeedbackFollowUp(null);
                  feedback.setFeedbackCommentDraft("");
                }}
                disabled={isSubmittingFeedback}
              >
                {text.chat.cancel}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  const composer = feedback.feedbackComposer;
                  if (!composer) return;
                  void (async () => {
                    await feedback.submitFeedback(
                      message.id,
                      composer.value,
                      displayedText,
                      displayedSources,
                      previousUserQuery,
                      feedback.feedbackCommentDraft.trim() || null
                    );
                    feedback.setFeedbackComposer(null);
                    feedback.setFeedbackFollowUp(null);
                    feedback.setFeedbackCommentDraft("");
                  })();
                }}
                disabled={isSubmittingFeedback || !conversationIdRef.current}
              >
                {text.chat.sendFeedback}
              </Button>
            </div>
          </div>
        )}
        {/* Show sources for assistant messages */}
        {message.role === "assistant" && hasText && displayedSources && displayedSources.length > 0 && (
          <SourcesPanel
            chunks={displayedSources}
            language={language}
            showScriptureCoverage={shouldShowScriptureCoverage}
          />
        )}
      </MessageContent>
    </Message>
  );
}
