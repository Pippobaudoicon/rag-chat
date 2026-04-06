"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { CheckIcon, CopyIcon, WrenchIcon } from "lucide-react";
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
import type { SourceType, Language, MessageMetadata } from "@/lib/types";
import { linkifyInlineCitations } from "@/lib/rag/citation-links";
import { parseScriptureSelection } from "@/lib/rag/scripture-reference";

interface ChatInterfaceProps {
  conversationId?: number;
  initialMessages?: UIMessage[];
}

type TextMessagePart = Extract<UIMessage["parts"][number], { type: "text" }>;

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
}: ChatInterfaceProps) {
  const [language, setLanguage] = useState<Language>("ita");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceType[]>([
    "scriptures",
    "conference",
    "handbook",
  ]);

  // Track the resolved conversation ID (may be created on first send)
  const conversationIdRef = useRef<number | undefined>(initialConversationId);

  const { messages, sendMessage, status, setMessages, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    messages: initialMessages,
  });

  const isStreaming = status === "streaming" || status === "submitted";

  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

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

      sendMessage(
        { text },
        {
          body: { conversationId: convId, language, sources, topK: 20 },
        }
      );
    },
    [language, sources, isStreaming, sendMessage]
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
    const onNewConversation = () => {
      stop();
      conversationIdRef.current = undefined;
      setMessages([]);
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
                const toolUsage = getToolUsage(message);
                const hasToolUsage = toolUsage.length > 0;
                // Extract sources from message metadata if available
                const metadata = message.metadata as MessageMetadata | undefined;
                const messageSources = metadata?.sources;
                const previousUserQuery = getPreviousUserQuery(messages, messageIndex);
                const shouldShowScriptureCoverage =
                  message.role === "assistant" &&
                  !!previousUserQuery &&
                  !!parseScriptureSelection(previousUserQuery, language);
                const isLastAssistantMessage =
                  message.role === "assistant" && messageIndex === messages.length - 1;
                const toolRunInProgress = isLastAssistantMessage && isStreaming && hasToolUsage;

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
                      {textParts.map((part, index) => (
                        <MessageResponse key={`${message.id}-${index}`}>
                          {linkifyInlineCitations(part.text, messageSources)}
                        </MessageResponse>
                      ))}
                      {/* Action toolbar under response */}
                      {messageText && message.role === "assistant" && (
                        <MessageToolbar>
                          <MessageAction
                            tooltip="Copy message"
                            size="sm"
                            className="cursor-pointer gap-1.5 px-2 text-xs text-muted-foreground"
                            onClick={() => {
                              void handleCopyMessage(message.id, messageText);
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
                        </MessageToolbar>
                      )}
                      {/* Show sources for assistant messages */}
                      {message.role === "assistant" && messageSources && messageSources.length > 0 && (
                        <SourcesPanel
                          chunks={messageSources}
                          language={language}
                          showScriptureCoverage={shouldShowScriptureCoverage}
                        />
                      )}
                    </MessageContent>
                  </Message>
                );
              })
            )}

            {/* Thinking indicator — shown only while waiting for the first token */}
            {status === "submitted" && (
              <Message from="assistant">
                <MessageContent>
                  <div className="flex items-center gap-1 px-1 py-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
                  </div>
                </MessageContent>
              </Message>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      {/* Input area */}
      <div className="border-t border-border/50 bg-background/80 backdrop-blur-sm px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <PromptInput onSubmit={handlePromptSubmit}>
            <PromptInputTextarea
              placeholder={
                language === "ita"
                  ? "Fai una domanda sulle scritture, la conferenza o il manuale…"
                  : "Ask a question about scriptures, conference, or handbook…"
              }
            />
            <PromptInputSubmit status={status} />
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
