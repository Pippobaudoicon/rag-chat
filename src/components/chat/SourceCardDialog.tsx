"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Language, SourceChunk } from "@/lib/types";
import { UI_LANGUAGE_NAMES, uiText } from "./i18n";

interface SourceCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chunk: SourceChunk;
  index: number;
  label: string;
  language: Language;
  openLabel: string;
}

export default function SourceCardDialog({
  open,
  onOpenChange,
  chunk,
  index,
  label,
  language,
  openLabel,
}: SourceCardDialogProps) {
  const text = uiText(language);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            {chunk.book
              ? `${chunk.book}${chunk.chapter ? ` ${chunk.chapter}` : ""}${chunk.verse ? `:${chunk.verse}` : ""}`
              : ""}
            {chunk.section ? `${chunk.book ? " · " : ""}${chunk.section}` : ""}
          </p>
        )}

        {chunk.language !== language && (
          <p className="text-xs text-muted-foreground">
            {text.sources.sourceLanguage}: {UI_LANGUAGE_NAMES[chunk.language]}
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
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        )}
      </DialogContent>
    </Dialog>
  );
}
