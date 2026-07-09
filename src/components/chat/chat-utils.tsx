"use client";

import { WrenchIcon } from "lucide-react";
import type { UIMessage } from "ai";
import type {
  ChatProgressData,
  ChatProgressPhase,
  MessageMetadata,
  UiLanguage,
} from "@/lib/types";
import { uiText } from "./i18n";

export type TextMessagePart = Extract<UIMessage["parts"][number], { type: "text" }>;
export type PendingPhase = Exclude<ChatProgressPhase, "complete">;
export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export const isTextPart = (part: UIMessage["parts"][number]): part is TextMessagePart =>
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

export function getToolUsage(message: UIMessage): string[] {
  const toolNames = message.parts
    .map(getToolNameFromPart)
    .filter((name): name is string => !!name);

  const metadataToolNames = (message.metadata as MessageMetadata | undefined)?.details?.toolNames ?? [];

  return [...new Set([...toolNames, ...metadataToolNames])];
}

export function getPlainText(message: UIMessage): string {
  return message.parts.filter(isTextPart).map((part) => part.text).join("\n\n").trim();
}

export function getPreviousUserQuery(messages: UIMessage[], fromIndex: number): string | null {
  for (let i = fromIndex - 1; i >= 0; i -= 1) {
    if (messages[i].role !== "user") continue;
    const text = getPlainText(messages[i]);
    if (text) return text;
  }
  return null;
}

function formatToolName(toolName: string): string {
  return toolName.replace(/_/g, " ");
}

function formatElapsedMs(elapsedMs: number | undefined): string | null {
  if (typeof elapsedMs !== "number" || elapsedMs < 1000) return null;
  return `${Math.max(1, Math.round(elapsedMs / 1000))}s`;
}

function getPendingLabel(
  language: UiLanguage,
  phase: PendingPhase,
  progress?: ChatProgressData | null
): string {
  const text = uiText(language);
  if (phase === "queued") return text.chat.pendingQueued;
  if (phase === "memory") return text.chat.pendingMemory;
  if (phase === "sources") {
    return progress?.toolName
      ? `${text.chat.pendingSources} ${formatToolName(progress.toolName)}`
      : text.chat.pendingSources;
  }
  if (phase === "tools") {
    if (typeof progress?.sourceCount === "number") {
      return `${text.chat.pendingTools} ${progress.sourceCount}`;
    }
    return text.chat.pendingTools;
  }
  return text.chat.pendingDrafting;
}

export function ToolActivityIndicator({
  language,
  progress,
  waitingPhrase,
  className,
}: {
  language: UiLanguage;
  progress?: ChatProgressData | null;
  waitingPhrase?: string;
  className?: string;
}) {
  const text = uiText(language);
  const toolName = progress?.toolName ? formatToolName(progress.toolName) : text.chat.pendingSources;
  const elapsed = formatElapsedMs(progress?.elapsedMs);
  const sourceCount =
    typeof progress?.sourceCount === "number"
      ? `${progress.sourceCount} ${text.chat.toolSourcesFound}`
      : null;

  return (
    <div
      className={`inline-flex max-w-sm flex-col gap-1 px-0 py-0 text-xs text-muted-foreground ${className ?? ""}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/50 opacity-70 animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
        </span>
        <WrenchIcon size={13} className="shrink-0 text-muted-foreground/70" />
        <span className="truncate font-medium text-foreground/85">
          {text.chat.toolWorking}
        </span>
        <span className="truncate text-muted-foreground/75">
          {toolName}
        </span>
        {(sourceCount || progress?.cacheHit || elapsed) && (
          <span className="ml-auto hidden shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground/65 sm:flex">
            {sourceCount && <span>{sourceCount}</span>}
            {progress?.cacheHit && <span>{text.chat.toolCacheHit}</span>}
            {elapsed && <span>{elapsed}</span>}
          </span>
        )}
      </div>
      {waitingPhrase && (
        <div className="truncate pl-7 text-[11px] text-muted-foreground/70">
          {waitingPhrase}
        </div>
      )}
    </div>
  );
}

export function PendingIndicator({
  language,
  phase,
  progress,
  waitingPhrase,
  className,
}: {
  language: UiLanguage;
  phase: PendingPhase;
  progress?: ChatProgressData | null;
  waitingPhrase?: string;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex flex-col gap-1 px-0 py-0 text-xs text-muted-foreground ${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:240ms]" />
        <span>{getPendingLabel(language, phase, progress)}</span>
      </span>
      {waitingPhrase && (
        <span className="max-w-xs truncate text-[11px] text-muted-foreground/70">
          {waitingPhrase}
        </span>
      )}
    </div>
  );
}
