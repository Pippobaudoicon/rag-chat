"use client";

import { useState } from "react";
import { SourceCard } from "./SourceCard";
import type { SourceChunk, Language } from "@/lib/types";

interface SourcesPanelProps {
  chunks: SourceChunk[];
  language?: Language;
}

export function SourcesPanel({ chunks, language = "ita" }: SourcesPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!chunks || chunks.length === 0) return null;

  const shown = expanded ? chunks : chunks.slice(0, 3);
  const label = language === "ita" ? "fonti" : "sources";

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
