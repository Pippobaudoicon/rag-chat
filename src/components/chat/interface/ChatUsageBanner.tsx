"use client";

import { AlertTriangleIcon } from "lucide-react";

import type { BillingUsageSnapshot } from "@/lib/billing/usage";

import { uiText } from "../i18n";

type UiText = ReturnType<typeof uiText>;

/** Remaining-messages warning: guests always, free users near their limit. */
export function ChatUsageBanner({
  chatUsage,
  isGuest,
  text,
}: {
  chatUsage: BillingUsageSnapshot;
  isGuest: boolean;
  text: UiText;
}) {
  return (
  <div className="px-4 pt-2">
    <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-border bg-card/60 px-3.5 py-1.5 text-sm sm:py-2.5">
      <AlertTriangleIcon className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
      <div className="min-w-0 flex-1">
        {/* Phones get one line: every pixel here comes out of the answer. */}
        <p className="truncate text-xs text-muted-foreground sm:hidden">
          {(isGuest ? text.chat.guestUsageShort : text.chat.usageWarningShort)
            .replace("{remaining}", String(chatUsage.remaining))
            .replace("{limit}", String(chatUsage.limit))}
        </p>
        <p className="hidden font-medium text-foreground sm:block">
          {isGuest ? text.chat.guestUsageTitle : text.chat.usageWarningTitle}
        </p>
        <p className="hidden text-xs text-muted-foreground sm:block">
          {(isGuest ? text.chat.guestUsageDescription : text.chat.usageWarningDescription)
            .replace("{remaining}", String(chatUsage.remaining))
            .replace("{limit}", String(chatUsage.limit))}
        </p>
      </div>
      {/* The only Sign-up CTA for guests: the top bar offers just Log in. */}
      <a
        href={isGuest ? "/sign-up" : "/billing"}
        className="shrink-0 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-85"
      >
        {isGuest ? text.chat.guestUsageAction : text.chat.usageWarningAction}
      </a>
    </div>
  </div>
  );
}
