"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  RefreshCwIcon,
  WrenchIcon,
} from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageToolbar,
  MessageAction,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { SettingsPanel } from "./SettingsPanel";
import { EmptyState } from "./EmptyState";
import { SourcesPanel } from "./SourcesPanel";
import type {
  AssistantVersion,
  SourceType,
  Language,
  MessageMetadata,
  SourceChunk,
} from "@/lib/types";
import { linkifyInlineCitations } from "@/lib/rag/citation-links";
import { parseScriptureSelection } from "@/lib/rag/scripture-reference";

interface ChatInterfaceProps {
  conversationId?: number;
  initialMessages?: UIMessage[];
  initialMessageVersions?: Record<string, AssistantVersion[]>;
  initialAssistantVersions?: AssistantVersion[][];
}

type TextMessagePart = Extract<UIMessage["parts"][number], { type: "text" }>;
type PendingPhase = "queued" | "tools" | "drafting";

const isTextPart = (part: UIMessage["parts"][number]): part is TextMessagePart =>
  part.type === "text";

function getToolNameFromPart(part: UIMessage["parts"][number]): string | null {
  const withToolName = part as { toolName?: unknown; name?: unknown; type?: unknown };
  if (typeof withToolName.toolName === "string" && withToolName.toolName.trim()) {
    return withToolName.toolName;
  }
  if (typeof withToolName.name === "string" && withToolName.name.trim()) {
    return withToolName.name;
  }
  if (typeof withToolName.type === "string" && withToolName.type.startsWith("tool-")) {
    return withToolName.type.slice(5);
  }
  return null;
}

function getToolUsage(message: UIMessage): string[] {
  const toolNames = message.parts
    .map(getToolNameFromPart)
    .filter((name): name is string => !!name);

  return [...new Set(toolNames)];
}

function hasVisibleAssistantText(message: UIMessage): boolean {
  if (message.role !== "assistant") return false;
  return message.parts
    .filter(isTextPart)
    .some((part) => part.text.trim().length > 0);
}

function getPendingLabel(language: Language, phase: PendingPhase): string {
  if (language === "ita") {
    if (phase === "queued") return "Invio della richiesta...";
    if (phase === "tools") return "Sto usando i tool sulle fonti...";
    return "Sto scrivendo la risposta...";
  }

  if (phase === "queued") return "Sending request...";
  if (phase === "tools") return "Using tools on sources...";
  return "Writing the response...";
}

function getLastAssistantMessageIndex(messages: UIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") return i;
  }
  return -1;
}

function PendingIndicator({
  language,
  phase,
  className,
}: {
  language: Language;
  phase: PendingPhase;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-md border border-border/50 bg-background/40 px-2 py-1 text-xs text-muted-foreground ${className ?? ""}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:120ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:240ms]" />
      <span>{getPendingLabel(language, phase)}</span>
    </div>
  );
}

function getPlainText(message: UIMessage): string {
  return message.parts.filter(isTextPart).map((part) => part.text).join("\n\n").trim();
}

function getPreviousUserQuery(messages: UIMessage[], fromIndex: number): string | null {
  for (let i = fromIndex - 1; i >= 0; i -= 1) {
    if (messages[i].role !== "user") continue;
    const text = getPlainText(messages[i]);
    if (text) return text;
  }
  return null;
}

export function ChatInterface({
  conversationId: initialConversationId,
  initialMessages = [],
  initialMessageVersions = {},
  initialAssistantVersions = [],
}: ChatInterfaceProps) {
  const [language, setLanguage] = useState<Language>("ita");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceType[]>([
    "scriptures",
    "conference",
    "handbook",
  ]);
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
  const conversationIdRef = useRef<number | undefined>(initialConversationId);
  const pendingRegenerationRef = useRef<
    | {
        targetMessageId: string;
        previousVersion: AssistantVersion;
      }
    | null
  >(null);

  const { messages, sendMessage, regenerate, status, setMessages, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    messages: initialMessages,
  });

  const isStreaming = status === "streaming" || status === "submitted";
  const hasAnyVisibleAssistantText = messages.some(hasVisibleAssistantText);
  const lastAssistantMessageIndex = getLastAssistantMessageIndex(messages);

  const ensureConversation = useCallback(async () => {
    // If there's no conversation yet, create one so history is always persisted.
    // Use window.history.replaceState so the URL updates WITHOUT a React navigation
    // (router.push would unmount this component and wipe the optimistic messages).
    let convId = conversationIdRef.current;
    if (!convId) {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, sources }),
      });
      if (res.ok) {
        const convo = await res.json();
        convId = convo.id as number;
        conversationIdRef.current = convId;
        // Update URL bar silently — no remount, keeps optimistic messages intact.
        window.history.replaceState(null, "", `/chat/${convId}`);
        window.dispatchEvent(
          new CustomEvent("chat:path-changed", {
            detail: { path: `/chat/${convId}` },
          })
        );
        window.dispatchEvent(new CustomEvent("chat:conversations-changed"));
      }
    }

    return convId;
  }, [language, sources]);

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      const convId = await ensureConversation();

      sendMessage(
        { text },
        {
          body: { conversationId: convId, language, sources, topK: 20 },
        }
      );
    },
    [ensureConversation, isStreaming, language, sendMessage, sources]
  );

  const handleRegenerate = useCallback(
    async (messageId: string, question: string, currentText: string, fixedChunks: SourceChunk[]) => {
      if (!question.trim() || !currentText.trim() || fixedChunks.length === 0 || isStreaming) return;

      const convId = await ensureConversation();

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
          topK: 20,
          fixedChunks,
          regenerateQuestion: question,
        },
      });
    },
    [ensureConversation, isStreaming, language, regenerate, sources]
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
      conversationIdRef.current = undefined;
      setMessages([]);
      setMessageVersions({});
      setActiveVersionIndex({});
      pendingRegenerationRef.current = null;
      if (window.location.pathname !== "/chat") {
        window.history.replaceState(null, "", "/chat");
      }
      window.dispatchEvent(
        new CustomEvent("chat:path-changed", {
          detail: { path: "/chat" },
        })
      );
    };

    window.addEventListener("chat:new-conversation", onNewConversation);
    return () => {
      window.removeEventListener("chat:new-conversation", onNewConversation);
    };
  }, [setMessages, stop]);

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

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Settings bar — language + source toggles */}
      <SettingsPanel
        language={language}
        onLanguageChange={setLanguage}
        sources={sources}
        onSourcesChange={setSources}
        disabled={isStreaming}
      />

      {/* Message list */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Conversation className="h-full px-4 py-6 max-w-3xl mx-auto">
          <ConversationContent>
            {messages.length === 0 ? (
              <EmptyState language={language} onSelect={handleSubmit} />
            ) : (
              messages.map((message, messageIndex) => {
                const textParts = message.parts.filter(isTextPart);
                const messageText = textParts.map((part) => part.text).join("\n\n");
                const hasText = messageText.trim().length > 0;
                const toolUsage = getToolUsage(message);
                const hasToolUsage = toolUsage.length > 0;
                // Extract sources from message metadata if available
                const metadata = message.metadata as MessageMetadata | undefined;
                const messageSources = metadata?.sources;
                const persistedVersions = metadata?.versions ?? [];
                const previousUserQuery = getPreviousUserQuery(messages, messageIndex);
                const versions = messageVersions[message.id] ?? persistedVersions;
                const hasVersions = versions.length > 1;
                const currentVersionIndex =
                  hasVersions
                    ? Math.min(activeVersionIndex[message.id] ?? versions.length - 1, versions.length - 1)
                    : 0;
                const displayedText =
                  hasVersions ? versions[currentVersionIndex].text : messageText;
                const displayedSources =
                  hasVersions ? versions[currentVersionIndex].sources : messageSources;
                const shouldShowScriptureCoverage =
                  message.role === "assistant" &&
                  !!previousUserQuery &&
                  !!parseScriptureSelection(previousUserQuery, language);
                const isLastAssistantMessage = messageIndex === lastAssistantMessageIndex;
                const toolRunInProgress = isLastAssistantMessage && isStreaming && hasToolUsage;
                const isAssistantPending =
                  message.role === "assistant" && isLastAssistantMessage && isStreaming && !hasText;
                const pendingPhase: PendingPhase =
                  status === "submitted"
                    ? "queued"
                    : toolRunInProgress
                      ? "tools"
                      : "drafting";

                return (
                  <Message key={message.id} from={message.role}>
                    <MessageContent>
                      {message.role === "assistant" && hasToolUsage && (
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className="h-6 gap-1.5 border-indigo-500/30 bg-indigo-500/10 text-indigo-300"
                          >
                            <WrenchIcon size={12} />
                            {toolRunInProgress
                              ? language === "ita"
                                ? "Tool in uso"
                                : "Using tools"
                              : language === "ita"
                                ? "Tool usati"
                                : "Tools used"}
                          </Badge>
                          {toolUsage.map((toolName) => (
                            <Badge
                              key={`${message.id}-${toolName}`}
                              variant="outline"
                              className="h-6 border-border/60 bg-background/50 text-muted-foreground"
                            >
                              {toolName}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {hasVersions ? (
                        <MessageResponse>{linkifyInlineCitations(displayedText, displayedSources)}</MessageResponse>
                      ) : (
                        textParts.map((part, index) => (
                          <MessageResponse key={`${message.id}-${index}`}>
                            {linkifyInlineCitations(part.text, messageSources)}
                          </MessageResponse>
                        ))
                      )}
                      {isAssistantPending && (
                        <PendingIndicator language={language} phase={pendingPhase} className="mt-1" />
                      )}
                      {/* Action toolbar under response */}
                      {hasText && message.role === "assistant" && (
                        <MessageToolbar className="justify-start gap-1.5">
                          {hasVersions && (
                            <>
                              <MessageAction
                                tooltip={language === "ita" ? "Versione precedente" : "Previous version"}
                                size="sm"
                                disabled={currentVersionIndex === 0}
                                className="cursor-pointer px-2 text-xs text-muted-foreground"
                                onClick={() => {
                                  setActiveVersionIndex((prev) => ({
                                    ...prev,
                                    [message.id]: Math.max(0, currentVersionIndex - 1),
                                  }));
                                }}
                              >
                                <ChevronLeftIcon size={14} />
                              </MessageAction>
                              <span className="px-1 text-xs text-muted-foreground">
                                {currentVersionIndex + 1}/{versions.length}
                              </span>
                              <MessageAction
                                tooltip={language === "ita" ? "Versione successiva" : "Next version"}
                                size="sm"
                                disabled={currentVersionIndex >= versions.length - 1}
                                className="cursor-pointer px-2 text-xs text-muted-foreground"
                                onClick={() => {
                                  setActiveVersionIndex((prev) => ({
                                    ...prev,
                                    [message.id]: Math.min(versions.length - 1, currentVersionIndex + 1),
                                  }));
                                }}
                              >
                                <ChevronRightIcon size={14} />
                              </MessageAction>
                            </>
                          )}
                          <MessageAction
                            tooltip="Copy message"
                            size="sm"
                            className="cursor-pointer gap-1.5 px-2 text-xs text-muted-foreground"
                            onClick={() => {
                              void handleCopyMessage(message.id, displayedText);
                            }}
                          >
                            {copiedId === message.id ? (
                              <>
                                <CheckIcon size={14} />
                                <span>Copied!</span>
                              </>
                            ) : (
                              <CopyIcon size={14} />
                            )}
                          </MessageAction>
                          <MessageAction
                            tooltip={language === "ita" ? "Rigenera risposta" : "Regenerate answer"}
                            size="sm"
                            disabled={
                              isStreaming || !previousUserQuery || !displayedSources || displayedSources.length === 0
                            }
                            className="cursor-pointer gap-1.5 px-2 text-xs text-muted-foreground"
                            onClick={() => {
                              if (!previousUserQuery || !displayedSources || displayedSources.length === 0) {
                                return;
                              }
                              void handleRegenerate(message.id, previousUserQuery, displayedText, displayedSources);
                            }}
                          >
                            <RefreshCwIcon size={14} />
                          </MessageAction>
                        </MessageToolbar>
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
              })
            )}

            {/* Global pending indicator when no assistant message has visible text yet */}
            {isStreaming && !hasAnyVisibleAssistantText && lastAssistantMessageIndex === -1 && (
              <Message from="assistant">
                <MessageContent>
                  <PendingIndicator
                    language={language}
                    phase={status === "submitted" ? "queued" : "drafting"}
                    className="px-0 py-0 text-xs"
                  />
                </MessageContent>
              </Message>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      {/* Input area */}
      <div className="border-t border-border/50 bg-linear-to-b from-background to-muted/20 backdrop-blur-sm px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <PromptInput
            onSubmit={handlePromptSubmit}
            className="rounded-full transition-all duration-200 **:data-[slot=input-group]:h-auto **:data-[slot=input-group]:rounded-full **:data-[slot=input-group]:border **:data-[slot=input-group]:border-border/70 **:data-[slot=input-group]:bg-background/95 **:data-[slot=input-group]:px-2.5 **:data-[slot=input-group]:shadow-[inset_0_1px_0_hsl(var(--background)),0_8px_20px_-14px_hsl(var(--foreground)/0.45)] focus-within:**:data-[slot=input-group]:border-primary/50 focus-within:**:data-[slot=input-group]:shadow-[inset_0_1px_0_hsl(var(--background)),0_12px_28px_-14px_hsl(var(--foreground)/0.55)]"
          >
            <PromptInputTextarea
              className="min-h-14 max-h-44 px-4 pt-4 pb-2 text-[15px] leading-6 placeholder:text-muted-foreground/80"
              placeholder={
                language === "ita"
                  ? "Fai una domanda sulle scritture, la conferenza o il manuale…"
                  : "Ask a question about scriptures, conference, or handbook…"
              }
            />
            <PromptInputSubmit
              status={status}
              onStop={() => {
                void stop();
              }}
              className="mr-1.5 mb-1.5 self-end size-11 rounded-full border border-primary/20 bg-primary text-primary-foreground shadow-[0_10px_20px_-10px_hsl(var(--primary)/0.85)] transition-all hover:scale-[1.03] hover:bg-primary/90 active:scale-100 disabled:opacity-60"
            />
          </PromptInput>
          <p className="mt-2 text-center text-[11px] text-muted-foreground/50">
            {language === "ita"
              ? "Le risposte sono basate su fonti ufficiali della Chiesa SUD."
              : "Answers are grounded in official LDS Church sources."}
          </p>
        </div>
      </div>
    </div>
  );
}
