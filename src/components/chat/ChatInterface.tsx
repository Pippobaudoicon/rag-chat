"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import { useChat } from "@ai-sdk/react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { AlertTriangleIcon, ZapIcon } from "lucide-react";
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
import { EmptyState } from "./EmptyState";
import { ChatMessage } from "./ChatMessage";
import {
  PendingIndicator,
  ToolActivityIndicator,
  getPlainText,
  getPreviousUserQuery,
} from "./chat-utils";
import { useMessageFeedback } from "./useMessageFeedback";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ALL_SOURCES, SUPER_SOURCES } from "@/lib/types";
import type {
  AssistantVersion,
  ChatGenerationStatus,
  ChatProgressData,
  UiLanguage,
  MessageMetadata,
  SourceChunk,
} from "@/lib/types";
import {
  DEFAULT_RESPONSE_STYLE,
  type ResponseStyleId,
} from "@/lib/rag/system-prompt";
import { useLanguage } from "./language-context";
import { uiText } from "./i18n";
import type { BillingEntitlements } from "@/lib/billing/entitlements";
import type { BillingUsageSummary } from "@/lib/billing/usage";
import type { OnboardingStatus } from "@/lib/onboarding/steps";
import {
  CHAT_GENERATION_CLAIM_TIMEOUT_MS,
  shouldAutoFocusNewChatComposer,
  shouldFailGenerationClaim,
  shouldShowPendingAssistant,
} from "@/lib/chat/client-lifecycle";

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

type BillingOverview = BillingEntitlements & { usage: BillingUsageSummary };
type EnsuredConversation = { id: string; initialMessageId?: number };

const WAITING_PHRASE_INTERVAL_MS = 3400;

function deriveConversationTitle(question: string): string {
  const normalized = question.trim();
  let title = normalized.slice(0, 60);

  if (normalized.length > 60) {
    const lastSpace = title.lastIndexOf(" ");
    title = (lastSpace > 20 ? title.slice(0, lastSpace) : title) + "…";
  }

  return title;
}

function randomIndex(length: number): number {
  if (length <= 1) return 0;
  return Math.floor(Math.random() * length);
}

function getLastAssistantMessageIndex(messages: UIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") return i;
  }
  return -1;
}

/** Compact Standard/Super search-scope toggle for the composer toolbar. */
function SearchScopeToggle({
  language,
  isSuper,
  onToggle,
  disabled,
}: {
  language: UiLanguage;
  isSuper: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const scope = uiText(language).settings.searchScope;
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        data-tour="super-toggle"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={isSuper}
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-all disabled:opacity-50 ${
          isSuper
            ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
            : "border-border/50 bg-transparent text-muted-foreground hover:border-border hover:text-foreground"
        }`}
      >
        <ZapIcon size={13} className={isSuper ? "text-amber-400" : ""} />
        <span className="hidden sm:inline">{scope.super}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
        <p className="mb-0.5 font-medium">{isSuper ? scope.super : scope.standard}</p>
        <p className="text-muted-foreground">
          {isSuper ? scope.superTooltip : scope.standardTooltip}
        </p>
      </TooltipContent>
    </Tooltip>
  );
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
  const router = useRouter();
  const { language } = useLanguage();
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
  // Search scope replaces manual per-source selection: Standard sends every
  // normally-visible source, Super sends all namespaces. The model may still
  // narrow *within* this scope (the backend ceilings its override to it).
  const [searchScope, setSearchScope] = useState<"standard" | "super">("standard");
  const sources = useMemo(
    () => (searchScope === "super" ? SUPER_SOURCES : ALL_SOURCES),
    [searchScope]
  );

  // Response style. The user's persistent default applies unless this
  // conversation has an explicit override (conversationStyle !== null). The
  // active style shown in the UI and sent for new conversations is derived
  // below.
  const [defaultResponseStyle, setDefaultResponseStyle] =
    useState<ResponseStyleId>(initialDefaultResponseStyle);
  const [conversationStyle, setConversationStyle] = useState<ResponseStyleId | null>(
    initialResponseStyle
  );
  const activeResponseStyle = conversationStyle ?? defaultResponseStyle;

  // Fallback: fetch the user's saved default if the server didn't provide one.
  useEffect(() => {
    if (initialDefaultResponseStyle !== DEFAULT_RESPONSE_STYLE) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = (await res.json()) as { defaultResponseStyle?: ResponseStyleId };
        if (!cancelled && data.defaultResponseStyle) {
          setDefaultResponseStyle(data.defaultResponseStyle);
        }
      } catch {
        // Settings fetch is non-critical; keep the system default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialDefaultResponseStyle]);

  const handleResponseStyleChange = useCallback((style: ResponseStyleId) => {
    setConversationStyle(style);
    const convId = conversationIdRef.current;
    if (convId) {
      // Persist the override immediately so it sticks even without sending.
      void fetch(`/api/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responseStyle: style }),
      });
    }
  }, []);

  const handleSetDefaultResponseStyle = useCallback((style: ResponseStyleId) => {
    setDefaultResponseStyle(style);
    void fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultResponseStyle: style }),
    });
  }, []);

  // Hydrate the search scope from localStorage after mount to avoid SSR mismatch.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("chat:search-scope");
      if (stored === "super" || stored === "standard") setSearchScope(stored);
    } catch {
      // ignore
    }
  }, []);
  const [expandedDetailsId, setExpandedDetailsId] = useState<string | null>(null);
  const [chatProgress, setChatProgress] = useState<ChatProgressData | null>(null);
  const [persistedGenerationStatus, setPersistedGenerationStatus] =
    useState<ChatGenerationStatus>(initialGenerationStatus);
  const [resolvedConversationId, setResolvedConversationId] =
    useState<string | undefined>(initialConversationId);
  const [billingOverview, setBillingOverview] = useState<BillingOverview | null>(null);
  const [waitingPhraseIndex, setWaitingPhraseIndex] = useState(0);
  const [messageVersions, setMessageVersions] = useState<Record<string, AssistantVersion[]>>(
    initialMessageVersions
  );
  const [activeVersionIndex, setActiveVersionIndex] = useState<Record<string, number>>(() => {
    const initialIndexes: Record<string, number> = {};
    for (const [messageId, versions] of Object.entries(initialMessageVersions)) {
      initialIndexes[messageId] = Math.max(versions.length - 1, 0);
    }
    return initialIndexes;
  });

  // Track the resolved conversation ID (may be created on first send)
  const conversationIdRef = useRef<string | undefined>(initialConversationId);
  const conversationContextVersionRef = useRef(0);
  const conversationCreationPromiseRef = useRef<Promise<EnsuredConversation> | null>(null);
  const submitTokenRef = useRef<symbol | null>(null);
  const resumeInFlightRef = useRef(false);
  const resumeAllowedRef = useRef(initialGenerationStatus === "streaming");
  const generationClaimPendingRef = useRef(false);
  const generationClaimStartedAtRef = useRef<number | null>(null);
  const clientTransportErrorRef = useRef(false);
  const pendingConversationTitleRef = useRef<string | null>(null);
  const pendingRegenerationRef = useRef<
    | {
        targetMessageId: string;
        previousVersion: AssistantVersion;
      }
    | null
  >(null);

  const feedback = useMessageFeedback(initialFeedbackByMessageId, conversationIdRef);

  const markGenerationClaimError = useCallback(() => {
    generationClaimPendingRef.current = false;
    generationClaimStartedAtRef.current = null;
    clientTransportErrorRef.current = false;
    setPersistedGenerationStatus("error");
    setChatProgress(null);
    window.dispatchEvent(new CustomEvent("chat:conversations-changed"));
  }, []);

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
    setMessages,
    stop,
  } = useChat({
    ...(initialConversationId ? { id: initialConversationId } : {}),
    transport: chatTransport,
    messages: initialMessages,
    onData: (dataPart) => {
      if (dataPart.type !== "data-chat-progress") return;

      const progress = dataPart.data as ChatProgressData;
      generationClaimPendingRef.current = false;
      generationClaimStartedAtRef.current = null;
      clientTransportErrorRef.current = false;
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
      clientTransportErrorRef.current = true;
    },
    onFinish: ({ isAbort, isDisconnect, isError }) => {
      if (isAbort || isDisconnect || isError) return;

      generationClaimPendingRef.current = false;
      generationClaimStartedAtRef.current = null;
      clientTransportErrorRef.current = false;
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
    },
  });

  const isStreaming =
    status === "streaming" ||
    status === "submitted" ||
    persistedGenerationStatus === "streaming";
  const chatStatusRef = useRef(status);
  chatStatusRef.current = status;
  const showPendingAssistant = shouldShowPendingAssistant(messages, isStreaming);
  const lastAssistantMessageIndex = getLastAssistantMessageIndex(messages);
  const userDisplayName =
    user?.firstName ||
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    null;
  const waitingPhrases = text.chat.waitingPhrases;
  const waitingPhrase =
    isStreaming && waitingPhrases.length > 0
      ? waitingPhrases[waitingPhraseIndex % waitingPhrases.length]
      : undefined;
  const chatUsage = billingOverview?.usage.chat;
  const shouldShowUsageWarning =
    billingOverview?.plan === "free" &&
    chatUsage?.available &&
    (chatUsage.percentUsed >= 75 || chatUsage.remaining <= 5);
  const composerStatus = isStreaming ? "submitted" : status;

  const refreshBillingOverview = useCallback(async () => {
    try {
      const response = await fetch("/api/billing/subscription", { cache: "no-store" });
      if (!response.ok) return;
      setBillingOverview((await response.json()) as BillingOverview);
    } catch {
      // Billing status should not interrupt chat.
    }
  }, []);

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

  // Persist the search scope (language is persisted by LanguageProvider).
  useEffect(() => {
    localStorage.setItem("chat:search-scope", searchScope);
  }, [searchScope]);

  useEffect(() => {
    void refreshBillingOverview();
  }, [refreshBillingOverview]);

  useEffect(() => {
    if (!isStreaming || waitingPhrases.length <= 1) return;

    const interval = window.setInterval(() => {
      setWaitingPhraseIndex((current) => {
        const next = randomIndex(waitingPhrases.length);
        return next === current ? (next + 1) % waitingPhrases.length : next;
      });
    }, WAITING_PHRASE_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [isStreaming, waitingPhrases.length]);

  useEffect(() => {
    if (!resolvedConversationId || persistedGenerationStatus !== "streaming") return;

    let cancelled = false;
    let timer: number | undefined;

    const synchronizeGeneration = async () => {
      let shouldPollAgain = true;
      try {
        const response = await fetch(
          `/api/conversations/${resolvedConversationId}?status=1`,
          { cache: "no-store" }
        );
        if (!response.ok) return;

        const payload = (await response.json()) as {
          generationStatus: ChatGenerationStatus;
        };
        if (cancelled) return;

        if (payload.generationStatus === "streaming") {
          generationClaimPendingRef.current = false;
          generationClaimStartedAtRef.current = null;
          clientTransportErrorRef.current = false;
          setPersistedGenerationStatus("streaming");

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

        if (generationClaimPendingRef.current) {
          const claimFailed = shouldFailGenerationClaim(
            generationClaimStartedAtRef.current,
            clientTransportErrorRef.current
          );
          if (!claimFailed) {
            // The status can still reflect the preceding turn while /api/chat
            // is completing its authenticated generation claim.
            setPersistedGenerationStatus("streaming");
            return;
          }

          shouldPollAgain = false;
          markGenerationClaimError();
          return;
        }

        setPersistedGenerationStatus(payload.generationStatus);
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
    persistedGenerationStatus,
    resolvedConversationId,
    resumeStream,
    resumeStreamEnabled,
    router,
    markGenerationClaimError,
  ]);

  useEffect(() => {
    const startedAt = generationClaimStartedAtRef.current;
    if (
      !resolvedConversationId ||
      persistedGenerationStatus !== "streaming" ||
      !generationClaimPendingRef.current ||
      startedAt === null
    ) {
      return;
    }

    const remainingMs = Math.max(
      0,
      CHAT_GENERATION_CLAIM_TIMEOUT_MS - (Date.now() - startedAt)
    );
    const timer = window.setTimeout(() => {
      if (generationClaimPendingRef.current) markGenerationClaimError();
    }, remainingMs);
    return () => window.clearTimeout(timer);
  }, [markGenerationClaimError, persistedGenerationStatus, resolvedConversationId]);

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
          generationClaimPendingRef.current = true;
          generationClaimStartedAtRef.current = Date.now();
          clientTransportErrorRef.current = false;
          setWaitingPhraseIndex(randomIndex(uiText(language).chat.waitingPhrases.length));
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
      conversationStyle,
      ensureConversation,
      isStreaming,
      language,
      messages.length,
      sendMessage,
      sources,
    ]
  );

  const handleRegenerate = useCallback(
    async (messageId: string, question: string, currentText: string, fixedChunks: SourceChunk[]) => {
      if (!question.trim() || !currentText.trim() || fixedChunks.length === 0 || isStreaming) return;

      const { id: convId } = await ensureConversation();
      generationClaimPendingRef.current = true;
      generationClaimStartedAtRef.current = Date.now();
      clientTransportErrorRef.current = false;
      setPersistedGenerationStatus("streaming");
      setWaitingPhraseIndex(randomIndex(uiText(language).chat.waitingPhrases.length));
      setChatProgress({ phase: "queued", conversationId: convId });

      pendingRegenerationRef.current = {
        targetMessageId: messageId,
        previousVersion: {
          text: currentText,
          sources: fixedChunks,
        },
      };

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
    [ensureConversation, isStreaming, language, regenerate, sources, conversationStyle]
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

  const handleSelectVersion = useCallback((messageId: string, index: number) => {
    setActiveVersionIndex((prev) => ({ ...prev, [messageId]: index }));
  }, []);

  const handleToggleDetails = useCallback((messageId: string) => {
    setExpandedDetailsId((prev) => (prev === messageId ? null : messageId));
  }, []);

  useEffect(() => {
    if (initialAssistantVersions.length === 0 || messages.length === 0) return;

    const mappedVersions: Record<string, AssistantVersion[]> = {};
    const mappedActive: Record<string, number> = {};
    let assistantIndex = 0;

    for (const message of messages) {
      if (message.role !== "assistant") continue;
      const versions = initialAssistantVersions[assistantIndex] ?? [];
      if (versions.length > 0 && !messageVersions[message.id]) {
        mappedVersions[message.id] = versions;
        mappedActive[message.id] = Math.max(versions.length - 1, 0);
      }
      assistantIndex += 1;
    }

    if (Object.keys(mappedVersions).length > 0) {
      setMessageVersions((prev) => ({ ...prev, ...mappedVersions }));
      setActiveVersionIndex((prev) => ({ ...prev, ...mappedActive }));
    }
  }, [initialAssistantVersions, messageVersions, messages]);

  useEffect(() => {
    const onNewConversation = () => {
      void stop();
      conversationContextVersionRef.current += 1;
      conversationIdRef.current = undefined;
      conversationCreationPromiseRef.current = null;
      submitTokenRef.current = null;
      resumeInFlightRef.current = false;
      resumeAllowedRef.current = false;
      generationClaimPendingRef.current = false;
      generationClaimStartedAtRef.current = null;
      clientTransportErrorRef.current = false;
      pendingRegenerationRef.current = null;

      // Commit the blank-chat screen before focusing. Keeping this synchronous
      // preserves the initiating mobile gesture without letting the keyboard
      // appear over the previous conversation.
      flushSync(() => {
        setResolvedConversationId(undefined);
        setMessages([]);
        feedback.reset();
        setMessageVersions({});
        setActiveVersionIndex({});
        setChatProgress(null);
        setPersistedGenerationStatus("idle");
        setWaitingPhraseIndex(0);
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
  }, [feedback.reset, setMessages, stop]);

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
      const existing = prev[messageId];
      if (existing && existing.length > 0) {
        nextLength = existing.length + 1;
        return {
          ...prev,
          [messageId]: [...existing, { text: newText, sources: newSources }],
        };
      }

      nextLength = 2;

      return {
        ...prev,
        [messageId]: [pending.previousVersion, { text: newText, sources: newSources }],
      };
    });
    setActiveVersionIndex((prev) => {
      return { ...prev, [messageId]: Math.max(nextLength - 1, 0) };
    });

    pendingRegenerationRef.current = null;
  }, [isStreaming, messages]);

  useEffect(() => {
    if (status !== "ready") return;
    setChatProgress(null);
    setWaitingPhraseIndex(0);
    void refreshBillingOverview();
  }, [refreshBillingOverview, status]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {shouldShowUsageWarning && chatUsage && (
        <div className="border-b border-primary/20 bg-primary/10 px-4 py-2">
          <div className="mx-auto flex max-w-3xl flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="font-medium text-primary">{text.chat.usageWarningTitle}</p>
                <p className="text-xs text-muted-foreground">
                  {text.chat.usageWarningDescription.replace(
                    "{remaining}",
                    String(chatUsage.remaining)
                  )}
                </p>
              </div>
            </div>
            <a
              href="/billing"
              className="w-fit rounded-md border border-primary/30 bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              {text.chat.usageWarningAction}
            </a>
          </div>
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Conversation className="h-full px-4 py-6 max-w-3xl mx-auto">
          <ConversationContent
            className={messages.length === 0 ? "h-full gap-0 p-0" : undefined}
            scrollClassName={messages.length === 0 ? "[scrollbar-gutter:auto!important]" : undefined}
          >
            {messages.length === 0 ? (
              <EmptyState language={language} onSelect={handleSubmit} userName={userDisplayName} />
            ) : (
              messages.map((message, messageIndex) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  previousUserQuery={getPreviousUserQuery(messages, messageIndex)}
                  isLastAssistantMessage={messageIndex === lastAssistantMessageIndex}
                  language={language}
                  isStreaming={isStreaming}
                  status={status}
                  chatProgress={chatProgress}
                  waitingPhrase={waitingPhrase}
                  copiedId={copiedId}
                  expandedDetailsId={expandedDetailsId}
                  conversationIdRef={conversationIdRef}
                  versionsOverride={messageVersions[message.id]}
                  activeVersionIndex={activeVersionIndex[message.id]}
                  feedback={feedback}
                  onSelectVersion={handleSelectVersion}
                  onToggleDetails={handleToggleDetails}
                  onCopy={handleCopyMessage}
                  onRegenerate={handleRegenerate}
                />
              ))
            )}

            {/* Pending assistant after the newest user turn, even with older answers in history. */}
            {showPendingAssistant && (
              <Message from="assistant">
                <MessageContent>
                  {chatProgress?.phase === "sources" || chatProgress?.phase === "tools" ? (
                    <ToolActivityIndicator
                      language={language}
                      progress={chatProgress}
                      waitingPhrase={waitingPhrase}
                    />
                  ) : (
                    <PendingIndicator
                      language={language}
                      phase={
                        chatProgress && chatProgress.phase !== "complete"
                          ? chatProgress.phase
                          : status === "submitted"
                            ? "queued"
                            : "drafting"
                      }
                      progress={chatProgress}
                      waitingPhrase={waitingPhrase}
                      className="px-0 py-0 text-xs"
                    />
                  )}
                </MessageContent>
              </Message>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      {/* Input area */}
      <div className="pb-safe-compact border-t border-border/50 bg-linear-to-b from-background to-muted/20 backdrop-blur-sm px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <PromptInput
            data-tour="composer"
            onSubmit={handlePromptSubmit}
            className="rounded-[2rem] transition-all duration-200 **:data-[slot=input-group]:h-auto **:data-[slot=input-group]:rounded-[2rem] **:data-[slot=input-group]:border **:data-[slot=input-group]:border-border/70 **:data-[slot=input-group]:bg-background/95 **:data-[slot=input-group]:px-2.5 **:data-[slot=input-group]:shadow-[inset_0_1px_0_hsl(var(--background)),0_8px_20px_-14px_hsl(var(--foreground)/0.45)] focus-within:**:data-[slot=input-group]:border-primary/50 focus-within:**:data-[slot=input-group]:shadow-[inset_0_1px_0_hsl(var(--background)),0_12px_28px_-14px_hsl(var(--foreground)/0.55)]"
          >
            {/* text-base md:* is the codebase-wide input convention (see
                ui/textarea.tsx): iOS Safari zooms the viewport when focusing an
                input under 16px, so mobile keeps 16px and only desktop drops. */}
            <PromptInputTextarea
              ref={composerRef}
              className="min-h-14 max-h-44 px-4 pt-4 pb-2 text-base md:text-[15px] leading-6 placeholder:text-muted-foreground/80"
              enterKeyHint="send"
              placeholder={text.chat.placeholder}
            />
            <PromptInputFooter className="px-3 pt-0 pb-2">
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
                  isSuper={searchScope === "super"}
                  onToggle={() =>
                    setSearchScope((current) =>
                      current === "super" ? "standard" : "super"
                    )
                  }
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
                className="size-9 rounded-full border border-primary/20 bg-primary text-primary-foreground shadow-[0_10px_20px_-10px_hsl(var(--primary)/0.85)] transition-all hover:scale-[1.03] hover:bg-primary/90 active:scale-100 disabled:opacity-60"
              />
            </PromptInputFooter>
          </PromptInput>
          <p className="mt-2 text-center text-[9px] text-muted-foreground/50">
            {text.chat.disclaimer}
          </p>
        </div>
      </div>
    </div>
  );
}
