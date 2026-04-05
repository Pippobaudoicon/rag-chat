"use client";

import { useState } from "react";
import { SourceCard } from "./SourceCard";
import type { SourceChunk, Language } from "@/lib/types";

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

  if (!chunks || chunks.length === 0) return null;

  const shown = expanded ? chunks : chunks.slice(0, 3);
  const label = language === "ita" ? "fonti" : "sources";
  const scriptureCoverage = getScriptureCoverageLabel(chunks, language);

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
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((chunk, i) => (
            <SourceCard key={chunk.id} chunk={chunk} index={i} language={language} />
          ))}
        </div>
      )}
    </div>
  );
}
