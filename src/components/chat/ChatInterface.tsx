"use client";

import { useState, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { Conversation } from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { SettingsPanel } from "./SettingsPanel";
import { EmptyState } from "./EmptyState";
import type { SourceType, Language } from "@/lib/types";

interface ChatInterfaceProps {
  conversationId?: number;
  initialMessages?: UIMessage[];
}

export function ChatInterface({
  conversationId,
  initialMessages = [],
}: ChatInterfaceProps) {
  const [language, setLanguage] = useState<Language>("ita");
  const [sources, setSources] = useState<SourceType[]>([
    "scriptures",
    "conference",
    "handbook",
  ]);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    messages: initialMessages,
  });

  const isStreaming = status === "streaming" || status === "submitted";

  const handleSubmit = useCallback(
    (text: string) => {
      if (!text.trim() || isStreaming) return;
      sendMessage(
        { text },
        {
          // Pass per-request options in body (not in static transport config)
          // so language/sources state is always fresh at call time
          body: { conversationId, language, sources, topK: 20 },
        }
      );
    },
    [conversationId, language, sources, isStreaming, sendMessage]
  );

  const handlePromptSubmit = useCallback(
    (message: PromptInputMessage) => {
      handleSubmit(message.text);
    },
    [handleSubmit]
  );

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
          {messages.length === 0 ? (
            <EmptyState language={language} onSelect={handleSubmit} />
          ) : (
            messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {message.parts.map((part, i) =>
                    part.type === "text" ? (
                      <MessageResponse key={i}>{part.text}</MessageResponse>
                    ) : null
                  )}
                </MessageContent>
              </Message>
            ))
          )}
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
