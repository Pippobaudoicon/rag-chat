"use client";

import { useEffect, useRef, useState } from "react";
import { SourceCard } from "./SourceCard";
import type { SourceChunk, Language } from "@/lib/types";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SourcesPanelProps {
  chunks: SourceChunk[];
  language?: Language;
  showScriptureCoverage?: boolean;
}

interface ScriptureCoverageLabels {
  compact: string;
  full: string;
}

function formatChapterCoverage(chapters: number[]): string {
  const sorted = [...new Set(chapters)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return `${sorted[0]}`;

  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = current;
    prev = current;
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);

  return ranges.join(", ");
}

function getScriptureCoverageLabels(
  chunks: SourceChunk[],
  language: Language
): ScriptureCoverageLabels | null {
  const scriptureChunks = chunks.filter(
    (chunk) => chunk.source === "scriptures" && chunk.book && chunk.chapter
  );
  if (scriptureChunks.length === 0) return null;

  const byBook = new Map<string, number[]>();
  for (const chunk of scriptureChunks) {
    const book = chunk.book as string;
    const chapter = chunk.chapter as number;
    if (!byBook.has(book)) byBook.set(book, []);
    byBook.get(book)?.push(chapter);
  }

  const entries = [...byBook.entries()]
    .map(([book, chapters]) => ({ book, chapters: [...new Set(chapters)].sort((a, b) => a - b) }))
    .sort((a, b) => b.chapters.length - a.chapters.length);

  const prefix = language === "ita" ? "Copertura" : "Coverage";
  const full = `${prefix}: ${entries
    .map((entry) => `${entry.book} ${formatChapterCoverage(entry.chapters)}`)
    .join("; ")}`;

  if (entries.length === 1) {
    const { book, chapters } = entries[0];
    const coverage = formatChapterCoverage(chapters);
    return {
      compact: `${prefix}: ${book} ${coverage}`,
      full,
    };
  }

  const [main, ...rest] = entries;
  const suffix =
    language === "ita"
      ? ` + ${rest.length} ${rest.length === 1 ? "altro libro" : "altri libri"}`
      : ` + ${rest.length} ${rest.length === 1 ? "other book" : "other books"}`;
  return {
    compact: `${prefix}: ${main.book} ${formatChapterCoverage(main.chapters)}${suffix}`,
    full,
  };
}

export function SourcesPanel({
  chunks,
  language = "ita",
  showScriptureCoverage = true,
}: SourcesPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const railRef = useRef<HTMLDivElement | null>(null);

  if (!chunks || chunks.length === 0) return null;

  const shown = expanded ? chunks : chunks.slice(0, 3);
  const label = language === "ita" ? "fonti" : "sources";
  const scriptureCoverage = showScriptureCoverage
    ? getScriptureCoverageLabels(chunks, language)
    : null;

  useEffect(() => {
    const updateScrollButtons = () => {
      const rail = railRef.current;
      if (!rail) {
        setCanScrollLeft(false);
        setCanScrollRight(false);
        return;
      }

      const maxScrollLeft = rail.scrollWidth - rail.clientWidth;
      setCanScrollLeft(rail.scrollLeft > 4);
      setCanScrollRight(rail.scrollLeft < maxScrollLeft - 4);
    };

    updateScrollButtons();
    const rail = railRef.current;
    rail?.addEventListener("scroll", updateScrollButtons, { passive: true });
    window.addEventListener("resize", updateScrollButtons);

    return () => {
      rail?.removeEventListener("scroll", updateScrollButtons);
      window.removeEventListener("resize", updateScrollButtons);
    };
  }, [expanded, shown.length]);

  const scrollCards = (direction: "left" | "right") => {
    const rail = railRef.current;
    if (!rail) return;

    const amount = Math.max(rail.clientWidth * 0.8, 220);
    rail.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  return (
    <div className="mt-3 space-y-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {chunks.length} {label}
      </button>

      {scriptureCoverage && (
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="inline-flex cursor-help items-center rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[11px] text-blue-300">
                {scriptureCoverage.compact}
              </div>
            }
          />
          <TooltipContent side="top" align="start" className="max-w-md">
            <p className="text-xs leading-relaxed">{scriptureCoverage.full}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {expanded && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/90">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-pulse" />
            <span>
              {language === "ita"
                ? "Scorri in orizzontale per vedere tutte le fonti"
                : "Scroll horizontally to see all sources"}
            </span>
            <span className="text-muted-foreground/60">&lt;- -&gt;</span>
          </div>

          <div className="group/rail relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-5 bg-gradient-to-r from-background to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-5 bg-gradient-to-l from-background to-transparent" />

            <div className="pointer-events-none absolute inset-y-0 left-1 z-20 flex items-center">
              <button
                type="button"
                aria-label={language === "ita" ? "Scorri a sinistra" : "Scroll left"}
                disabled={!canScrollLeft}
                onClick={() => scrollCards("left")}
                className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-all md:opacity-0 md:group-hover/rail:opacity-100 md:group-focus-within/rail:opacity-100 enabled:hover:bg-card enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="pointer-events-none absolute inset-y-0 right-1 z-20 flex items-center">
              <button
                type="button"
                aria-label={language === "ita" ? "Scorri a destra" : "Scroll right"}
                disabled={!canScrollRight}
                onClick={() => scrollCards("right")}
                className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-all md:opacity-0 md:group-hover/rail:opacity-100 md:group-focus-within/rail:opacity-100 enabled:hover:bg-card enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>

            <div
              ref={railRef}
              className="flex snap-x gap-2 overflow-x-auto px-8 pb-1"
            >
              {shown.map((chunk, i) => (
                <div key={chunk.id} className="w-[220px] shrink-0 snap-start">
                  <SourceCard chunk={chunk} index={i} language={language} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
