import { useEffect, useMemo, useState } from "react";
import { ArrowUpRightIcon } from "lucide-react";
import type { UiLanguage } from "@/lib/types";
import { uiText } from "./i18n";

const SUGGESTION_COUNT = 3;

function pickRandomSuggestions(options: string[], count: number) {
  if (options.length <= count) {
    return options;
  }

  const shuffled = [...options];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[i]];
  }

  return shuffled.slice(0, count);
}

// The empty chat is split around the centered composer (ChatGPT-style):
// greeting above it, suggestions below it.

export function EmptyGreeting({
  language,
  userName,
}: {
  language: UiLanguage;
  userName?: string | null;
}) {
  const text = uiText(language);
  const greeting = userName
    ? text.empty.title.replace(/\?$/, ` ${userName}?`)
    : text.empty.title;

  return (
    <h1 className="text-balance text-center text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
      {greeting}
    </h1>
  );
}

export function EmptySuggestions({
  language,
  onSelect,
}: {
  language: UiLanguage;
  onSelect: (question: string) => void;
}) {
  const text = uiText(language);
  const options = useMemo(
    () => [...text.empty.suggestions],
    [text.empty.suggestions]
  );

  // Keep the first server/client render deterministic, then randomize on mount.
  const [suggestions, setSuggestions] = useState<string[]>(() =>
    options.slice(0, SUGGESTION_COUNT)
  );

  useEffect(() => {
    setSuggestions(pickRandomSuggestions(options, SUGGESTION_COUNT));
  }, [options]);

  return (
    <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onSelect(suggestion)}
          className="group flex w-64 shrink-0 snap-start items-start justify-between gap-2 rounded-2xl border border-border bg-card/40 px-3.5 py-3 text-left text-sm leading-snug text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:w-auto"
        >
          <span className="line-clamp-2">{suggestion}</span>
          <ArrowUpRightIcon className="mt-0.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
        </button>
      ))}
    </div>
  );
}
