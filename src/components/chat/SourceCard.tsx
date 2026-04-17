"use client";

import { lazy, Suspense, useState } from "react";
import { cn } from "@/lib/utils";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/types";
import type { SourceChunk, Language } from "@/lib/types";

const SourceCardDialog = lazy(() => import("./SourceCardDialog"));

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

      {open && (
        <Suspense>
          <SourceCardDialog
            open={open}
            onOpenChange={setOpen}
            chunk={chunk}
            index={index}
            label={label}
            openLabel={openLabel}
          />
        </Suspense>
      )}
    </>
  );
}
