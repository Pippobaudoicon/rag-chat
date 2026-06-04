"use client";

import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StarIcon, ZapIcon } from "lucide-react";
import { ALL_SOURCES, SUPER_SOURCES } from "@/lib/types";
import type { SourceType, UiLanguage } from "@/lib/types";
import { RESPONSE_STYLE_IDS } from "@/lib/rag/system-prompt";
import type { ResponseStyleId } from "@/lib/rag/system-prompt";
import { LanguageToggle } from "./LanguageToggle";
import { sourceLabel, uiText } from "./i18n";

interface SettingsPanelProps {
  language: UiLanguage;
  sources: SourceType[];
  onSourcesChange: (sources: SourceType[]) => void;
  // Response-style controls are optional: only the chat surface renders them.
  // The search console reuses this panel for source filtering only.
  responseStyle?: ResponseStyleId;
  defaultResponseStyle?: ResponseStyleId;
  onResponseStyleChange?: (style: ResponseStyleId) => void;
  onSetDefaultResponseStyle?: () => void;
  disabled?: boolean;
}

function arraysEqual(a: SourceType[], b: SourceType[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

export function SettingsPanel({
  language,
  sources,
  onSourcesChange,
  responseStyle,
  defaultResponseStyle,
  onResponseStyleChange,
  onSetDefaultResponseStyle,
  disabled = false,
}: SettingsPanelProps) {
  const isSuperActive = arraysEqual(sources, SUPER_SOURCES);
  const text = uiText(language);
  const showStylePicker = !!responseStyle && !!onResponseStyleChange;
  const isStyleDefault = responseStyle === defaultResponseStyle;

  function toggleSource(source: SourceType) {
    if (sources.includes(source)) {
      // Keep at least one source active
      if (sources.length === 1) return;
      onSourcesChange(sources.filter((s) => s !== source));
    } else {
      onSourcesChange([...sources, source]);
    }
  }

  function toggleSuper() {
    if (isSuperActive) {
      // Turn off super → go back to default visible sources
      onSourcesChange(ALL_SOURCES);
    } else {
      onSourcesChange([...SUPER_SOURCES]);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border/50 bg-background/50 py-2 px-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] backdrop-blur-sm md:px-4">
      {/* Source toggles */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {ALL_SOURCES.map((source) => {
          const active = sources.includes(source);
          const label = sourceLabel(source, language);
          return (
            <button
              key={source}
              onClick={() => {
                if (isSuperActive) return;
                toggleSource(source);
              }}
              disabled={disabled || isSuperActive}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-all disabled:opacity-50 ${
                active
                  ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"
                  : "border-border/50 bg-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${active ? "bg-indigo-400" : "bg-muted-foreground/40"}`}
              />
              {label}
            </button>
          );
        })}

        <Separator orientation="vertical" className="h-4" />

        {/* Super toggle */}
        <Tooltip>
          <TooltipTrigger
            onClick={toggleSuper}
            disabled={disabled}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold transition-all disabled:opacity-50 ${
              isSuperActive
                ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                : "border-border/50 bg-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <ZapIcon size={12} className={isSuperActive ? "text-amber-400" : ""} />
            Super
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
            <div>
              <p className="mb-1 font-medium">{text.settings.searchAllSources}</p>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
                {SUPER_SOURCES.map((s) => (
                  <li key={s}>
                    {sourceLabel(s, language)}
                  </li>
                ))}
              </ul>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Response-style picker — controls the voice/altitude of answers */}
      {showStylePicker && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground">
            {text.settings.responseStyle}:
          </span>
          {RESPONSE_STYLE_IDS.map((id) => {
            const active = responseStyle === id;
            const style = text.settings.styles[id];
            return (
              <Tooltip key={id}>
                <TooltipTrigger
                  onClick={() => onResponseStyleChange?.(id)}
                  disabled={disabled}
                  aria-label={text.settings.responseStyleAria}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-all disabled:opacity-50 ${
                    active
                      ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"
                      : "border-border/50 bg-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  {style.label}
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                  {style.description}
                </TooltipContent>
              </Tooltip>
            );
          })}

          {/* Set the active style as the user's persistent default */}
          {onSetDefaultResponseStyle && (
            <Tooltip>
              <TooltipTrigger
                onClick={onSetDefaultResponseStyle}
                disabled={disabled || isStyleDefault}
                aria-label={text.settings.setAsDefault}
                className={`inline-flex items-center justify-center rounded-md border p-1 transition-all disabled:opacity-60 ${
                  isStyleDefault
                    ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                    : "border-border/50 bg-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                <StarIcon size={12} className={isStyleDefault ? "fill-current" : ""} />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {isStyleDefault ? text.settings.isDefault : text.settings.setAsDefault}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {/* Language switch — desktop only; on mobile it lives in the top bar */}
      <div className="ml-auto hidden md:flex">
        <LanguageToggle disabled={disabled} />
      </div>
    </div>
  );
}
