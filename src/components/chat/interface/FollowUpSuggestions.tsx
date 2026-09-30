"use client";

import { SparklesIcon } from "lucide-react";

import type { uiText } from "../i18n";

type FollowUpText = ReturnType<typeof uiText>["chat"]["followUps"];

/** Touch screens: a thin scrollable row of suggestion chips above the composer. */
export function FollowUpChips({
  followUps,
  text,
  onSelect,
}: {
  followUps: string[];
  text: FollowUpText;
  onSelect: (question: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={text.label}
      className="-mx-4 mb-2 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] animate-in fade-in slide-in-from-bottom-1 duration-300 pointer-fine:hidden [&::-webkit-scrollbar]:hidden"
    >
      <SparklesIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground/60" />
      {followUps.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onSelect(question)}
          className="max-w-[80vw] shrink-0 truncate rounded-full border border-border/70 bg-card/60 px-3 py-1.5 text-[13px] text-muted-foreground transition-colors active:bg-accent active:text-foreground"
        >
          {question}
        </button>
      ))}
    </div>
  );
}

/**
 * Desktop: the composer placeholder shows a suggestion and this hint teaches
 * Tab. It spells the action out until the user has used Tab a few times, then
 * keeps only the key. Clicking it does the same as Tab.
 */
export function FollowUpTabHint({
  text,
  learned,
  filled,
  canCycle,
  onAccept,
}: {
  text: FollowUpText;
  learned: boolean;
  /** The composer holds an untouched suggestion (Tab shows the next one). */
  filled: boolean;
  canCycle: boolean;
  onAccept: () => void;
}) {
  if (filled && !canCycle) return null;
  const action = filled ? text.tabNext : text.tabUse;
  return (
    <button
      type="button"
      onClick={onAccept}
      title={`Tab ${action}`}
      aria-label={`Tab ${action}`}
      className="hidden h-7 items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground/70 transition-colors animate-in fade-in duration-300 hover:bg-accent hover:text-foreground pointer-fine:inline-flex"
    >
      <kbd className="rounded border border-border bg-muted/50 px-1.5 font-sans text-[11px] leading-5">
        Tab
      </kbd>
      {!learned && <span>{action}</span>}
    </button>
  );
}
