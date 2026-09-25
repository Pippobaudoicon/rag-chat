"use client";

import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";

import type { ChatErrorKind } from "@/lib/chat/client-lifecycle";

import { uiText } from "../i18n";

type UiText = ReturnType<typeof uiText>;

/** Inline card for a failed turn, with the matching way out. */
export function ChatErrorCard({
  errorKind,
  isGuest,
  failedQuestion,
  text,
  onRetry,
}: {
  errorKind: ChatErrorKind;
  isGuest: boolean;
  /** The unanswered question; without it there is nothing to retry. */
  failedQuestion: string | null;
  text: UiText;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
    >
      <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{text.chat.errorTitle}</p>
        <p className="mt-0.5 text-muted-foreground">
          {errorKind === "quota"
            ? isGuest
              ? text.chat.errorQuotaGuest
              : text.chat.errorQuota
            : errorKind === "busy"
              ? text.chat.errorBusy
              : errorKind === "network"
                ? text.chat.errorNetwork
                : text.chat.errorGeneric}
        </p>
      </div>
      {errorKind === "quota" ? (
        <a
          href={isGuest ? "/sign-up" : "/billing"}
          className="shrink-0 self-center rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-85"
        >
          {isGuest ? text.chat.guestUsageAction : text.chat.usageWarningAction}
        </a>
      ) : (
        failedQuestion && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex shrink-0 items-center gap-1.5 self-center rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            <RotateCcwIcon className="h-3.5 w-3.5" />
            {text.chat.errorRetry}
          </button>
        )
      )}
    </div>
  );
}
