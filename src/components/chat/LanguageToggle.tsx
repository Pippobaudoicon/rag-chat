"use client";

import { ChevronDownIcon, GlobeIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLanguage } from "./language-context";
import { cn } from "@/lib/utils";
import { SUPPORTED_UI_LANGUAGES } from "@/lib/types";
import type { UiLanguage } from "@/lib/types";
import { UI_LANGUAGE_CODES, UI_LANGUAGE_NAMES, uiText } from "./i18n";

interface LanguageToggleProps {
  className?: string;
  disabled?: boolean;
}

export function LanguageToggle({ className, disabled = false }: LanguageToggleProps) {
  const { language, setLanguage } = useLanguage();
  const text = uiText(language);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <label
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-border has-disabled:opacity-50",
              className
            )}
          >
            <GlobeIcon size={14} className="pointer-events-none shrink-0" />
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as UiLanguage)}
              disabled={disabled}
              aria-label={text.language.selectAria}
              className="min-w-12 cursor-pointer appearance-none bg-transparent pr-4 font-semibold tracking-wide outline-none disabled:cursor-not-allowed"
            >
              {SUPPORTED_UI_LANGUAGES.map((option) => (
                <option key={option} value={option}>
                  {UI_LANGUAGE_CODES[option]}
                </option>
              ))}
            </select>
            <ChevronDownIcon size={12} className="pointer-events-none absolute right-1.5" />
          </label>
        }
      >
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {text.language.selectLabel}: {UI_LANGUAGE_NAMES[language]}
      </TooltipContent>
    </Tooltip>
  );
}
