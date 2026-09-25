"use client";

import { useState } from "react";
import { ZapIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { UiLanguage } from "@/lib/types";

import { uiText } from "../i18n";

/** Compact Standard/Super search-scope toggle for the composer toolbar. */
export function SearchScopeToggle({
  language,
  isSuper,
  onToggle,
  disabled,
  locked,
}: {
  language: UiLanguage;
  isSuper: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** Guests can't use Super; the tooltip explains why. */
  locked?: boolean;
}) {
  const scope = uiText(language).settings.searchScope;
  // Controlled so a tap can open it: touch never fires hover, and a locked
  // guest would otherwise get no feedback at all.
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        type="button"
        data-tour="super-toggle"
        closeOnClick={!locked}
        onClick={locked ? () => setOpen((current) => !current) : onToggle}
        disabled={disabled}
        aria-disabled={locked || undefined}
        aria-pressed={isSuper}
        className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${
          isSuper
            ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
      >
        <ZapIcon size={14} className={isSuper ? "fill-amber-400 text-amber-400" : ""} />
        <span>{scope.super}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
        <p className="mb-0.5 font-medium">{isSuper || locked ? scope.super : scope.standard}</p>
        <p className="text-muted-foreground">
          {locked ? scope.superGuestTooltip : isSuper ? scope.superTooltip : scope.standardTooltip}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
