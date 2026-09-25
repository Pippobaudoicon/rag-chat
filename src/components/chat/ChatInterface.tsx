"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import { useChat } from "@ai-sdk/react";
import { useUser } from "@clerk/nextjs";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputFooter,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { ResponseStylePicker } from "./ResponseStylePicker";
import { EmptyGreeting, EmptySuggestions } from "./EmptyState";
import { ChatMessage } from "./ChatMessage";
import {
  AssistantActivityIndicator,
  getPlainText,
  getPreviousUserQuery,
} from "./chat-utils";
import { useMessageFeedback } from "./useMessageFeedback";
import type {
  AssistantVersion,
  ChatGenerationStatus,
  ChatProgressData,
  SourceChunk,
} from "@/lib/types";
import {
  DEFAULT_RESPONSE_STYLE,
  type ResponseStyleId,
} from "@/lib/rag/system-prompt";
import { useLanguage } from "./language-context";
import { uiText } from "./i18n";
import { useBillingOverview } from "@/components/billing/BillingContext";
import type { OnboardingStatus } from "@/lib/onboarding/steps";
import {
  chatErrorKind,
  shouldAutoFocusNewChatComposer,
  shouldShowPendingAssistant,
} from "@/lib/chat/client-lifecycle";
import { ChatErrorCard } from "./interface/ChatErrorCard";
import { ChatUsageBanner } from "./interface/ChatUsageBanner";
import { SearchScopeToggle } from "./interface/SearchScopeToggle";
import { useGenerationState, useGenerationSync } from "./interface/useGenerationSync";
import { useMessageVersions } from "./interface/useMessageVersions";
import { useResponseStyle } from "./interface/useResponseStyle";
import { useSearchScope } from "./interface/useSearchScope";

interface ChatInterfaceProps {
  conversationId?: string;
  initialMessages?: UIMessage[];
  initialMessageVersions?: Record<string, AssistantVersion[]>;
  initialAssistantVersions?: AssistantVersion[][];
  initialFeedbackByMessageId?: Record<string, { value: "up" | "down"; comment: string | null }>;
  // Per-conversation style override (null/undefined = inherit user default).
  initialResponseStyle?: ResponseStyleId | null;
  // The user's persistent default style (applied when no override is set).
  initialDefaultResponseStyle?: ResponseStyleId;
  initialOnboardingStatus?: OnboardingStatus;
  initialGenerationStatus?: ChatGenerationStatus;
  resumeStreamEnabled?: boolean;
}

type EnsuredConversation = { id: string; initialMessageId?: number };

function deriveConversationTitle(question: string): string {
  const normalized = question.trim();
  let title = normalized.slice(0, 60);

  if (normalized.length > 60) {
    const lastSpace = title.lastIndexOf(" ");
    title = (lastSpace > 20 ? title.slice(0, lastSpace) : title) + "…";
  }

  return title;
}

export function ChatInterface({
  conversationId: initialConversationId,
  initialMessages = [],
  initialMessageVersions = {},
  initialAssistantVersions = [],
  initialFeedbackByMessageId = {},
  initialResponseStyle = null,
  initialDefaultResponseStyle = DEFAULT_RESPONSE_STYLE,
  initialOnboardingStatus,
  initialGenerationStatus = "idle",
  resumeStreamEnabled = false,
}: ChatInterfaceProps) {
  const { user } = useUser();
  const { language } = useLanguage();
  const { billingOverview, refreshBillingOverview } = useBillingOverview();
  const text = uiText(language);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const isEmptyNewChat =
    initialConversationId === undefined && initialMessages.length === 0;
  const shouldFocusNewChatAfterPaint = shouldAutoFocusNewChatComposer(
    initialConversationId,
    initialMessages.length,
    initialOnboardingStatus === "pending"
  );
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const shouldFocusExistingDesktopChat =
      !isEmptyNewChat && window.matchMedia("(pointer: fine)").matches;
    if (!shouldFocusNewChatAfterPaint && !shouldFocusExistingDesktopChat) {
      return;
    }

    // Wait until ChatInterface has replaced the route loading boundary and
    // painted. A native autoFocus attribute can open the mobile keyboard while
    // the page is still visibly loading.
    let focusFrameId: number | undefined;
    const paintFrameId = window.requestAnimationFrame(() => {
      focusFrameId = window.requestAnimationFrame(() => {
        composerRef.current?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(paintFrameId);
      if (focusFrameId !== undefined) {
        window.cancelAnimationFrame(focusFrameId);
      }
    };
  }, [isEmptyNewChat, shouldFocusNewChatAfterPaint]);
  const isGuest = billingOverview?.plan === "guest";
  const { isSuperScope, sources, toggleSearchScope } = useSearchScope(isGuest);

  // Track the resolved conversation ID (may be created on first send)
  const conversationIdRef = useRef<string | undefined>(initialConversationId);
  const {
    defaultResponseStyle,
    conversationStyle,
    activeResponseStyle,
    handleResponseStyleChange,
    handleSetDefaultResponseStyle,
  } = useResponseStyle(initialDefaultResponseStyle, initialResponseStyle, conversationIdRef);

  const [expandedDetailsId, setExpandedDetailsId] = useState<string | null>(null);
  const [resolvedConversationId, setResolvedConversationId] =
    useState<string | undefined>(initialConversationId);
  const conversationContextVersionRef = useRef(0);
  const conversationCreationPromiseRef = useRef<Promise<EnsuredConversation> | null>(null);
  const submitTokenRef = useRef<symbol | null>(null);
  const pendingConversationTitleRef = useRef<string | null>(null);

  const feedback = useMessageFeedback(initialFeedbackByMessageId, conversationIdRef);
  const resetFeedback = feedback.reset;

  const generation = useGenerationState(initialGenerationStatus);
  const {
    chatProgress,
    setChatProgress,
    generationStatus: persistedGenerationStatus,
    setGenerationStatus: setPersistedGenerationStatus,
    beginClaim,
    settleClaim,
    markTransportError,
    resetGeneration,
  } = generation;

  const chatTransport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    []
  );

  const {
    messages,
    sendMessage,
    regenerate,
    resumeStream,
    status,
    error: chatError,
    setMessages,
    stop,
  } = useChat({
    ...(initialConversationId ? { id: initialConversationId } : {}),
    transport: chatTransport,
    messages: initialMessages,
    onData: (dataPart) => {
      if (dataPart.type !== "data-chat-progress") return;
      const progress = dataPart.data as ChatProgressData;
      settleClaim();
      setChatProgress(progress.phase === "complete" ? null : progress);
      setPersistedGenerationStatus(
        progress.phase === "complete" ? "complete" : "streaming"
      );

      if (progress.conversationId && conversationIdRef.current !== progress.conversationId) {
        const title = progress.title ?? pendingConversationTitleRef.current ?? text.sidebar.untitledChat;
        conversationIdRef.current = progress.conversationId;
        setResolvedConversationId(progress.conversationId);
        pendingConversationTitleRef.current = null;

        const path = `/chat/${progress.conversationId}`;
        window.history.replaceState(null, "", path);
        window.dispatchEvent(
          new CustomEvent("chat:path-changed", {
            detail: { path },
          })
        );
        window.dispatchEvent(
          new CustomEvent("chat:conversation-updated", {
            detail: {
              id: progress.conversationId,
              title,
              generationStatus: "streaming",
              updatedAt: new Date().toISOString(),
            },
          })
        );
      }
    },
    onError: () => {
      // The SDK reports transport errors without rejecting sendMessage(). Keep
      // polling once so a server-owned generation can still prove it was claimed.
      markTransportError();
      // A quota rejection (429) should update the remaining-messages banner.
      void refreshBillingOverview();
    },
    onFinish: ({ isAbort, isDisconnect, isError }) => {
      if (isAbort || isDisconnect || isError) return;

      settleClaim();
      setPersistedGenerationStatus("complete");
      setChatProgress(null);

      const convId = conversationIdRef.current;
      if (convId) {
        window.dispatchEvent(
          new CustomEvent("chat:conversation-updated", {
            detail: {
              id: convId,
              generationStatus: "complete",
              updatedAt: new Date().toISOString(),
            },
          })
        );
      }
      window.dispatchEvent(new CustomEvent("chat:conversations-changed"));
      void refreshBillingOverview();
    },
  });

  useGenerationSync(generation, {
    conversationId: resolvedConversationId,
    chatStatus: status,
    initialGenerationStatus,
    resumeStreamEnabled,
    resumeStream,
  });

  const isStreaming =
    status === "streaming" ||
    status === "submitted" ||
    persistedGenerationStatus === "streaming";
  const {
    versionsFor,
    activeVersionIndexFor,
    selectVersion,
    beginRegeneration,
    resetVersions,
  } = useMessageVersions({
    messages,
    isStreaming,
    initialMessageVersions,
    initialAssistantVersions,
  });
  const showPendingAssistant = shouldShowPendingAssistant(messages, isStreaming);
  const userDisplayName =
    user?.firstName ||
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    null;
  const chatUsage = billingOverview?.usage.chat;
  const shouldShowUsageWarning =
    chatUsage?.available &&
    (isGuest ||
      (billingOverview?.plan === "free" &&
        (chatUsage.percentUsed >= 75 || chatUsage.remaining <= 5)));
  const composerStatus = isStreaming ? "submitted" : status;
  // A failed turn: the SDK's transport/stream error, or the server-side claim
  // check (polling) that marked the generation failed.
  const failedTurn =
    !isStreaming && (!!chatError || persistedGenerationStatus === "error");
  const lastMessage = messages.at(-1);
  const errorKind = chatError ? chatErrorKind(chatError, navigator.onLine) : "generic";
  const failedQuestion =
    failedTurn && lastMessage?.role === "user" ? getPlainText(lastMessage) : null;

  const ensureConversation = useCallback(async (initialTurn?: {
    title: string;
    message: string;
  }): Promise<EnsuredConversation> => {
    // If there's no conversation yet, create one so history is always persisted.
    // Use window.history.replaceState so the URL updates WITHOUT a React navigation
    // (router.push would unmount this component and wipe the optimistic messages).
    const existingId = conversationIdRef.current;
    if (existingId) return { id: existingId };
    if (conversationCreationPromiseRef.current) {
      return conversationCreationPromiseRef.current;
    }

    const contextVersion = conversationContextVersionRef.current;
    const pathAtStart = window.location.pathname;
    const creationPromise = (async () => {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language,
          sources,
          responseStyle: conversationStyle ?? undefined,
          title: initialTurn?.title,
          initialMessage: initialTurn?.message,
        }),
      });
      if (!res.ok) {
        throw new Error(`Conversation creation failed with status ${res.status}`);
      }

      const convo = (await res.json()) as EnsuredConversation;
      const convId = convo.id;
      if (conversationContextVersionRef.current === contextVersion) {
        conversationIdRef.current = convId;
        setResolvedConversationId(convId);
        // Update URL bar silently — no remount, keeps optimistic messages intact.
        if (pathAtStart === "/chat" && window.location.pathname === pathAtStart) {
          window.history.replaceState(null, "", `/chat/${convId}`);
          window.dispatchEvent(
            new CustomEvent("chat:path-changed", {
              detail: { path: `/chat/${convId}` },
            })
          );
        }
      }

      return convo;
    })();

    conversationCreationPromiseRef.current = creationPromise;
    try {
      return await creationPromise;
    } finally {
      if (conversationCreationPromiseRef.current === creationPromise) {
        conversationCreationPromiseRef.current = null;
      }
    }
  }, [language, sources, conversationStyle]);

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming || submitTokenRef.current) return;

      const submitToken = Symbol("chat-submit");
      submitTokenRef.current = submitToken;
      const contextVersion = conversationContextVersionRef.current;
      const trimmedText = text.trim();
      const title = deriveConversationTitle(trimmedText);
      pendingConversationTitleRef.current = conversationIdRef.current ? null : title;

      try {
        const ensuredConversation = await ensureConversation({
          title,
          message: trimmedText,
        });
        const convId = ensuredConversation.id;
        const isCurrentContext =
          conversationContextVersionRef.current === contextVersion;

        if (isCurrentContext) {
          pendingConversationTitleRef.current = null;
          beginClaim();
          setChatProgress({ phase: "queued", conversationId: convId, title });
          setPersistedGenerationStatus("streaming");
        }

        window.dispatchEvent(
          new CustomEvent("chat:conversation-updated", {
            detail: {
              id: convId,
              title: messages.length === 0 ? title : undefined,
              generationStatus: "streaming",
              updatedAt: new Date().toISOString(),
            },
          })
        );

        const requestBody = {
          conversationId: convId,
          language,
          sources,
          responseStyle: conversationStyle ?? undefined,
          topK: 20,
          persistedUserMessageId: ensuredConversation.initialMessageId,
        };
        const generationPromise = isCurrentContext
          ? sendMessage({ text: trimmedText }, { body: requestBody })
          : fetch("/api/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...requestBody,
                messages: [
                  {
                    role: "user",
                    parts: [{ type: "text", text: trimmedText }],
                  },
                ],
              }),
            }).then(async (response) => {
              if (!response.ok) {
                throw new Error(
                  `Detached chat generation failed with status ${response.status}`
                );
              }
              await response.body?.cancel();
            });

        void generationPromise
          .catch((error) => {
            console.error("Failed to generate chat response", error);
            if (conversationContextVersionRef.current === contextVersion) {
              setPersistedGenerationStatus("error");
              setChatProgress(null);
            }
          })
          .finally(() => {
            if (submitTokenRef.current === submitToken) {
              submitTokenRef.current = null;
            }
          });
      } catch (error) {
        if (submitTokenRef.current === submitToken) {
          submitTokenRef.current = null;
        }
        pendingConversationTitleRef.current = null;
        setChatProgress(null);
        throw error;
      }
    },
    [
      beginClaim,
      conversationStyle,
      ensureConversation,
      isStreaming,
      language,
      messages.length,
      sendMessage,
      setChatProgress,
      setPersistedGenerationStatus,
      sources,
    ]
  );

  // Retry the unanswered turn in place. If the server already saved the
  // question (it is the conversation's unanswered tail row), resend with its id
  // so /api/chat reuses that row instead of inserting a duplicate; otherwise
  // the plain resend lets the server insert it. Same contract as mobile.
  const retryInFlightRef = useRef(false);
  const handleRetry = useCallback(async () => {
    if (!failedQuestion || isStreaming || retryInFlightRef.current) return;
    retryInFlightRef.current = true;
    const convId = conversationIdRef.current;
    if (!convId) {
      // The conversation was never created, so nothing is stored yet.
      setMessages((current) => current.slice(0, -1));
      retryInFlightRef.current = false;
      void handleSubmit(failedQuestion);
      return;
    }

    let persistedUserMessageId: number | undefined;
    try {
      const response = await fetch(`/api/conversations/${convId}`, { cache: "no-store" });
      if (response.ok) {
        const payload = (await response.json()) as {
          messages?: { id: number; role: string; content: string }[];
        };
        const tail = payload.messages?.at(-1);
        if (tail?.role === "user" && tail.content === failedQuestion) {
          persistedUserMessageId = tail.id;
        }
      }
    } catch {
      // Offline: sending below fails too and the error card comes back.
    }

    beginClaim();
    setChatProgress({ phase: "queued", conversationId: convId });
    setPersistedGenerationStatus("streaming");
    retryInFlightRef.current = false; // isStreaming guards from here on
    // No new message: resubmit the existing history, whose tail is the question.
    void sendMessage(undefined, {
      body: {
        conversationId: convId,
        language,
        sources,
        responseStyle: conversationStyle ?? undefined,
        topK: 20,
        persistedUserMessageId,
      },
    });
  }, [
    beginClaim,
    conversationStyle,
    failedQuestion,
    handleSubmit,
    isStreaming,
    language,
    sendMessage,
    setChatProgress,
    setMessages,
    setPersistedGenerationStatus,
    sources,
  ]);

  const handleRegenerate = useCallback(
    async (messageId: string, question: string, currentText: string, fixedChunks: SourceChunk[]) => {
      if (!question.trim() || !currentText.trim() || fixedChunks.length === 0 || isStreaming) return;

      const { id: convId } = await ensureConversation();
      beginClaim();
      setPersistedGenerationStatus("streaming");
      setChatProgress({ phase: "queued", conversationId: convId });

      beginRegeneration(messageId, {
        text: currentText,
        sources: fixedChunks,
      });

      await regenerate({
        messageId,
        body: {
          conversationId: convId,
          language,
          sources,
          responseStyle: conversationStyle ?? undefined,
          topK: 20,
          fixedChunks,
          regenerateQuestion: question,
        },
      });
    },
    [
      beginClaim,
      beginRegeneration,
      ensureConversation,
      isStreaming,
      language,
      regenerate,
      setChatProgress,
      setPersistedGenerationStatus,
      sources,
      conversationStyle,
    ]
  );

  const handlePromptSubmit = useCallback(
    (message: PromptInputMessage) => {
      // Return the promise so PromptInput can await it before clearing the form
      return handleSubmit(message.text);
    },
    [handleSubmit]
  );

  const handleCopyMessage = useCallback(async (id: string, text: string) => {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error("Failed to copy message", error);
    }
  }, []);

  const handleToggleDetails = useCallback((messageId: string) => {
    setExpandedDetailsId((prev) => (prev === messageId ? null : messageId));
  }, []);

  useEffect(() => {
    const onNewConversation = () => {
      void stop();
      conversationContextVersionRef.current += 1;
      conversationIdRef.current = undefined;
      conversationCreationPromiseRef.current = null;
      submitTokenRef.current = null;

      // Commit the blank-chat screen before focusing. Keeping this synchronous
      // preserves the initiating mobile gesture without letting the keyboard
      // appear over the previous conversation.
      flushSync(() => {
        setResolvedConversationId(undefined);
        setMessages([]);
        resetFeedback();
        resetVersions();
        resetGeneration();
      });

      if (window.location.pathname !== "/chat") {
        window.history.replaceState(null, "", "/chat");
      }
      window.dispatchEvent(
        new CustomEvent("chat:path-changed", {
          detail: { path: "/chat" },
        })
      );
      composerRef.current?.focus({ preventScroll: true });
    };

    window.addEventListener("chat:new-conversation", onNewConversation);
    return () => {
      window.removeEventListener("chat:new-conversation", onNewConversation);
    };
  }, [resetFeedback, resetGeneration, resetVersions, setMessages, stop]);

  const isEmptyChat = messages.length === 0;

  const composer = (
    <PromptInput
      data-tour="composer"
      onSubmit={handlePromptSubmit}
      className="**:data-[slot=input-group]:h-auto **:data-[slot=input-group]:rounded-3xl **:data-[slot=input-group]:border **:data-[slot=input-group]:border-border **:data-[slot=input-group]:bg-card **:data-[slot=input-group]:shadow-[0_8px_30px_-12px_rgb(0_0_0/0.5)]"
    >
      {/* text-base md:* is the codebase-wide input convention (see
          ui/textarea.tsx): iOS Safari zooms the viewport when focusing an
          input under 16px, so mobile keeps 16px and only desktop drops. */}
      <PromptInputTextarea
        ref={composerRef}
        className="min-h-14 max-h-52 px-4 pt-4 pb-1 text-base md:text-[15px] leading-6 placeholder:text-muted-foreground/70"
        enterKeyHint="send"
        placeholder={text.chat.placeholder}
      />
      <PromptInputFooter className="px-2.5 pt-1 pb-2.5">
        <PromptInputTools className="gap-1.5">
          <ResponseStylePicker
            language={language}
            value={activeResponseStyle}
            defaultStyle={defaultResponseStyle}
            onChange={handleResponseStyleChange}
            onSetDefault={handleSetDefaultResponseStyle}
            disabled={isStreaming}
          />
          <SearchScopeToggle
            language={language}
            isSuper={isSuperScope}
            locked={isGuest}
            onToggle={toggleSearchScope}
            disabled={isStreaming}
          />
        </PromptInputTools>
        <PromptInputSubmit
          status={composerStatus}
          disabled={isStreaming}
          {...(isStreaming
            ? {
                "aria-label": text.chat.pendingDrafting,
                title: text.chat.pendingDrafting,
              }
            : {})}
          className="size-9 md:size-8 rounded-full bg-foreground text-background transition-opacity hover:bg-foreground hover:opacity-85 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
        />
      </PromptInputFooter>
    </PromptInput>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {shouldShowUsageWarning && chatUsage && (
        <ChatUsageBanner chatUsage={chatUsage} isGuest={isGuest} text={text} />
      )}

      {/* One tree for both layouts so the composer never remounts (keeps focus
          and draft): an empty chat centers greeting + composer + suggestions
          (on mobile the composer stays docked at the bottom, suggestions sit
          above it); once there are messages the list fills and the composer docks. */}
      {isEmptyChat ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-6 md:justify-end md:pb-8">
          <EmptyGreeting language={language} userName={userDisplayName} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden">
          <Conversation className="h-full px-4 py-6 max-w-3xl mx-auto">
            <ConversationContent>
              {messages.map((message, messageIndex) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  previousUserQuery={getPreviousUserQuery(messages, messageIndex)}
                  isActiveAssistantMessage={
                    messageIndex === messages.length - 1 && message.role === "assistant"
                  }
                  language={language}
                  isStreaming={isStreaming}
                  status={status}
                  chatProgress={chatProgress}
                  copiedId={copiedId}
                  expandedDetailsId={expandedDetailsId}
                  conversationIdRef={conversationIdRef}
                  versionsOverride={versionsFor(message.id)}
                  activeVersionIndex={activeVersionIndexFor(message.id)}
                  feedback={feedback}
                  onSelectVersion={selectVersion}
                  onToggleDetails={handleToggleDetails}
                  onCopy={handleCopyMessage}
                  onRegenerate={handleRegenerate}
                />
              ))}

              {/* Pending assistant after the newest user turn, even with older answers in history. */}
              {showPendingAssistant && (
                <Message from="assistant">
                  <MessageContent>
                    <AssistantActivityIndicator
                      language={language}
                      afterTool={chatProgress?.toolCompleted === true}
                      phase={
                        chatProgress && chatProgress.phase !== "complete"
                          ? chatProgress.phase
                          : status === "submitted"
                            ? "queued"
                            : "drafting"
                      }
                    />
                  </MessageContent>
                </Message>
              )}
              {failedTurn && (
                <ChatErrorCard
                  errorKind={errorKind}
                  isGuest={isGuest}
                  failedQuestion={failedQuestion}
                  text={text}
                  onRetry={() => void handleRetry()}
                />
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>
      )}

      <div
        className={
          isEmptyChat
            ? "order-3 px-4 pb-safe-compact md:order-none md:pb-0"
            : "pb-safe-compact px-4 pt-1"
        }
      >
        <div className="mx-auto max-w-3xl">
          {composer}
          <p
            className={`mt-1.5 text-center text-[11px] text-muted-foreground/60 ${
              isEmptyChat ? "hidden" : ""
            }`}
          >
            {text.chat.disclaimer}
          </p>
        </div>
      </div>

      {isEmptyChat && (
        <div className="px-4 pb-3 md:flex-[1.15] md:pb-0 md:pt-2">
          <div className="mx-auto max-w-3xl">
            <EmptySuggestions language={language} onSelect={handleSubmit} />
          </div>
        </div>
      )}
    </div>
  );
}
