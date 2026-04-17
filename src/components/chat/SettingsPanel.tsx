"use client";

import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ZapIcon } from "lucide-react";
import { ALL_SOURCES, SUPER_SOURCES, SOURCE_LABELS } from "@/lib/types";
import type { SourceType, Language } from "@/lib/types";

interface SettingsPanelProps {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  sources: SourceType[];
  onSourcesChange: (sources: SourceType[]) => void;
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
  onLanguageChange,
  sources,
  onSourcesChange,
  disabled = false,
}: SettingsPanelProps) {
  const isSuperActive = arraysEqual(sources, SUPER_SOURCES);

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

  const superTooltipLabel =
    language === "ita"
      ? "Cerca in tutte le fonti:"
      : "Search all sources:";

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50 bg-background/50 backdrop-blur-sm flex-wrap">
      {/* Language toggle */}
      <div className="flex items-center gap-1 rounded-md border border-border/60 p-0.5">
        {(["ita", "eng"] as Language[]).map((lang) => (
          <button
            key={lang}
            onClick={() => onLanguageChange(lang)}
            disabled={disabled}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
              language === lang
                ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {lang === "ita" ? "IT" : "EN"}
          </button>
        ))}
      </div>

      <Separator orientation="vertical" className="h-4" />

      {/* Source toggles */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {ALL_SOURCES.map((source) => {
          const active = sources.includes(source);
          const label = SOURCE_LABELS[source][language === "ita" ? "it" : "en"];
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
              <p className="mb-1 font-medium">{superTooltipLabel}</p>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
                {SUPER_SOURCES.map((s) => (
                  <li key={s}>
                    {SOURCE_LABELS[s][language === "ita" ? "it" : "en"]}
                  </li>
                ))}
              </ul>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
