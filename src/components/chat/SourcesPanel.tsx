"use client";

import { useEffect, useRef, useState } from "react";
import { SourceCard } from "./SourceCard";
import type { SourceChunk, Language } from "@/lib/types";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

interface SourcesPanelProps {
  chunks: SourceChunk[];
  language?: Language;
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

function getScriptureCoverageLabel(chunks: SourceChunk[], language: Language): string | null {
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

  if (entries.length === 1) {
    const { book, chapters } = entries[0];
    const coverage = formatChapterCoverage(chapters);
    const prefix = language === "ita" ? "Copertura" : "Coverage";
    return `${prefix}: ${book} ${coverage}`;
  }

  const [main, ...rest] = entries;
  const suffix =
    language === "ita"
      ? ` + ${rest.length} ${rest.length === 1 ? "altro libro" : "altri libri"}`
      : ` + ${rest.length} ${rest.length === 1 ? "other book" : "other books"}`;
  const prefix = language === "ita" ? "Copertura" : "Coverage";
  return `${prefix}: ${main.book} ${formatChapterCoverage(main.chapters)}${suffix}`;
}

export function SourcesPanel({ chunks, language = "ita" }: SourcesPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const railRef = useRef<HTMLDivElement | null>(null);

  if (!chunks || chunks.length === 0) return null;

  const shown = expanded ? chunks : chunks.slice(0, 3);
  const label = language === "ita" ? "fonti" : "sources";
  const scriptureCoverage = getScriptureCoverageLabel(chunks, language);

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
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
        <div className="inline-flex items-center rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[11px] text-blue-300">
          {scriptureCoverage}
        </div>
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

            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                aria-label={language === "ita" ? "Scorri a sinistra" : "Scroll left"}
                disabled={!canScrollLeft}
                onClick={() => scrollCards("left")}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/50 bg-card/60 text-muted-foreground transition-colors enabled:hover:bg-card enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeftIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={language === "ita" ? "Scorri a destra" : "Scroll right"}
                disabled={!canScrollRight}
                onClick={() => scrollCards("right")}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/50 bg-card/60 text-muted-foreground transition-colors enabled:hover:bg-card enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRightIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-5 bg-gradient-to-r from-background to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-5 bg-gradient-to-l from-background to-transparent" />

            <div ref={railRef} className="flex snap-x gap-2 overflow-x-auto pb-1 pr-2">
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
