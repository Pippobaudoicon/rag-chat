"use client";

import { lazy, Suspense, useState } from "react";
import { cn } from "@/lib/utils";
import { SOURCE_COLORS } from "@/lib/types";
import type { SourceChunk, UiLanguage } from "@/lib/types";
import { sourceLabel, uiText, SOURCE_LANGUAGE_NAMES } from "./i18n";

const SourceCardDialog = lazy(() => import("./SourceCardDialog"));

interface SourceCardProps {
  chunk: SourceChunk;
  index: number;
  language?: UiLanguage;
}

export function SourceCard({ chunk, index, language = "ita" }: SourceCardProps) {
  const [open, setOpen] = useState(false);
  const text = uiText(language);
  const label = sourceLabel(chunk.source, language);
  const scorePercent = Math.round(chunk.score * 100);

  const tags = [
    ...(chunk.topics ?? []),
    ...(chunk.entities?.doctrines ?? []),
    ...(chunk.entities?.people ?? []),
    ...(chunk.entities?.places ?? []),
  ];
  const uniqueTags = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 6);
  const references = (chunk.references ?? []).slice(0, 4);

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
              {chunk.language !== language && (
                <span className="rounded border border-border/50 px-1 text-[10px] text-muted-foreground">
                  {SOURCE_LANGUAGE_NAMES[chunk.language]}
                </span>
              )}
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

          {uniqueTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {uniqueTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {references.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {references.map((ref) => (
                <span
                  key={ref}
                  className="rounded border border-primary/30 px-1.5 py-0.5 text-[9px] text-primary/80"
                >
                  {ref}
                </span>
              ))}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/80">{text.sources.tapToOpen}</p>
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
            language={language}
            openLabel={text.sources.open}
          />
        </Suspense>
      )}
    </>
  );
}
