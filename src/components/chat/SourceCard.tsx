"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/types";
import type { SourceChunk, Language } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SourceCardProps {
  chunk: SourceChunk;
  index: number;
  language?: Language;
}

export function SourceCard({ chunk, index, language = "ita" }: SourceCardProps) {
  const [open, setOpen] = useState(false);
  const label = SOURCE_LABELS[chunk.source][language === "ita" ? "it" : "en"];
  const scorePercent = Math.round(chunk.score * 100);
  const openLabel = language === "ita" ? "Apri fonte" : "Open source";
  const tapLabel = language === "ita" ? "Tocca per aprire" : "Tap to open";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-md border border-border/50 bg-card/50 p-2.5 text-left text-sm transition-colors hover:border-border hover:bg-card/80"
      >
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                  SOURCE_COLORS[chunk.source]
                )}
              >
                {label}
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {scorePercent}%
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground">#{index + 1}</span>
          </div>

          {chunk.title && (
            <p className="line-clamp-1 text-xs font-medium text-foreground/90">{chunk.title}</p>
          )}

          {(chunk.book || chunk.section || chunk.date) && (
            <p className="line-clamp-1 text-[11px] text-muted-foreground">
              {chunk.book ? `${chunk.book}${chunk.chapter ? ` ${chunk.chapter}` : ""}${chunk.verse ? `:${chunk.verse}` : ""}` : ""}
              {chunk.section ? `${chunk.book ? " · " : ""}${chunk.section}` : ""}
              {chunk.date ? `${chunk.book || chunk.section ? " · " : ""}${chunk.date}` : ""}
            </p>
          )}

          <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{chunk.text}</p>

          <p className="text-[10px] text-muted-foreground/80">{tapLabel}</p>
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="pr-8 text-sm">
              {chunk.title || `${label} #${index + 1}`}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {label}
              {chunk.speaker ? ` · ${chunk.speaker}` : ""}
              {chunk.date ? ` · ${chunk.date}` : ""}
            </DialogDescription>
          </DialogHeader>

          {(chunk.book || chunk.section) && (
            <p className="text-xs text-muted-foreground">
              {chunk.book ? `${chunk.book}${chunk.chapter ? ` ${chunk.chapter}` : ""}${chunk.verse ? `:${chunk.verse}` : ""}` : ""}
              {chunk.section ? `${chunk.book ? " · " : ""}${chunk.section}` : ""}
            </p>
          )}

          <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border/50 bg-muted/20 p-3 text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {chunk.text}
          </div>
          {chunk.url && (
            <a
              href={chunk.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-indigo-400 transition-colors hover:text-indigo-300"
            >
              {openLabel}
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
