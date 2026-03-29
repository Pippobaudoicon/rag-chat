import { cn } from "@/lib/utils";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/types";
import type { SourceChunk, Language } from "@/lib/types";

interface SourceCardProps {
  chunk: SourceChunk;
  index: number;
  language?: Language;
}

export function SourceCard({ chunk, index, language = "ita" }: SourceCardProps) {
  const label = SOURCE_LABELS[chunk.source][language === "ita" ? "it" : "en"];
  const scorePercent = Math.round(chunk.score * 100);

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 p-3 text-sm space-y-2 hover:border-border transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
              SOURCE_COLORS[chunk.source]
            )}
          >
            {label}
          </span>
          {chunk.title && (
            <span className="text-xs text-muted-foreground font-medium truncate max-w-[200px]">
              {chunk.title}
            </span>
          )}
          {chunk.speaker && (
            <span className="text-xs text-muted-foreground">— {chunk.speaker}</span>
          )}
        </div>
        {/* Relevance score bar */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500"
              style={{ width: `${scorePercent}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground w-7 text-right">
            {scorePercent}%
          </span>
        </div>
      </div>

      {/* Reference (scripture book/chapter/verse) */}
      {chunk.book && (
        <p className="text-xs font-mono text-muted-foreground">
          {chunk.book}
          {chunk.chapter ? ` ${chunk.chapter}` : ""}
          {chunk.verse ? `:${chunk.verse}` : ""}
          {chunk.section ? ` · ${chunk.section}` : ""}
          {chunk.date ? ` · ${chunk.date}` : ""}
        </p>
      )}

      {/* Chunk preview — first 180 chars */}
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
        {chunk.text}
      </p>

      {/* External link */}
      {chunk.url && (
        <a
          href={chunk.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          Apri fonte
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
    </div>
  );
}
