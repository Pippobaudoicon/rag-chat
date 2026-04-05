"use client";

import { useState, useCallback, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { CheckIcon, CopyIcon } from "lucide-react";
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
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { SettingsPanel } from "./SettingsPanel";
import { EmptyState } from "./EmptyState";
import { SourcesPanel } from "./SourcesPanel";
import type { SourceType, Language, MessageMetadata } from "@/lib/types";

interface ChatInterfaceProps {
  conversationId?: number;
  initialMessages?: UIMessage[];
}

type TextMessagePart = Extract<UIMessage["parts"][number], { type: "text" }>;

const isTextPart = (part: UIMessage["parts"][number]): part is TextMessagePart =>
  part.type === "text";

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

  const { messages, sendMessage, status } = useChat({
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
              messages.map((message) => {
                const textParts = message.parts.filter(isTextPart);
                const messageText = textParts.map((part) => part.text).join("\n\n");
                // Extract sources from message metadata if available
                const metadata = message.metadata as MessageMetadata | undefined;
                const messageSources = metadata?.sources;

                return (
                  <Message key={message.id} from={message.role}>
                    <MessageContent>
                      {textParts.map((part, index) => (
                        <MessageResponse key={`${message.id}-${index}`}>{part.text}</MessageResponse>
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
                        <SourcesPanel chunks={messageSources} language={language} />
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
