"use client";

import type { UIMessage } from "ai";
import type {
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

type ActivityLabelKey =
  | "pendingQueued"
  | "pendingMemory"
  | "pendingSources"
  | "pendingTools"
  | "pendingAfterTool"
  | "pendingDrafting";

const ACTIVITY_LABEL_KEYS: Partial<Record<PendingPhase, ActivityLabelKey>> = {
  queued: "pendingQueued",
  memory: "pendingMemory",
  sources: "pendingSources",
  tools: "pendingTools",
  drafting: "pendingDrafting",
};

function getPendingLabel(
  language: UiLanguage,
  phase: PendingPhase,
  afterTool: boolean
): string {
  const text = uiText(language);
  if (afterTool) return text.chat.pendingAfterTool;
  return text.chat[ACTIVITY_LABEL_KEYS[phase] ?? "pendingDrafting"];
}

export function AssistantActivityIndicator({
  language,
  phase,
  afterTool = false,
  className,
}: {
  language: UiLanguage;
  phase: PendingPhase;
  afterTool?: boolean;
  className?: string;
}) {
  const label = getPendingLabel(language, phase, afterTool);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={`inline-flex min-h-6 items-center gap-2 text-xs text-muted-foreground/80 ${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-0.5" aria-hidden="true">
        <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:-240ms] motion-reduce:animate-none" />
        <span className="size-1 animate-pulse rounded-full bg-current [animation-delay:-120ms] motion-reduce:animate-none" />
        <span className="size-1 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
      </span>
      <span className="font-medium">{label}</span>
    </div>
  );
}
