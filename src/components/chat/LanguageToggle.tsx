"use client";

import { GlobeIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLanguage } from "./language-context";
import { cn } from "@/lib/utils";

interface LanguageToggleProps {
  className?: string;
  disabled?: boolean;
}

export function LanguageToggle({ className, disabled = false }: LanguageToggleProps) {
  const { language, toggle } = useLanguage();

  return (
    <Tooltip>
      <TooltipTrigger
        onClick={toggle}
        disabled={disabled}
        aria-label={
          language === "ita"
            ? "Cambia lingua in inglese"
            : "Switch language to Italian"
        }
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-border disabled:opacity-50",
          className
        )}
      >
        <GlobeIcon size={14} />
        <span className="font-semibold tracking-wide">
          {language === "ita" ? "IT" : "EN"}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {language === "ita" ? "Passa all'inglese" : "Switch to Italian"}
      </TooltipContent>
    </Tooltip>
  );
}
