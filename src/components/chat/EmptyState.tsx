import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { Language } from "@/lib/types";
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

interface EmptyStateProps {
  language: Language;
  onSelect: (question: string) => void;
  userName?: string | null;
}

export function EmptyState({ language, onSelect, userName }: EmptyStateProps) {
  const text = uiText(language);
  const options = useMemo(
    () => [...text.empty.suggestions],
    [text.empty.suggestions]
  );
  const greeting = userName
    ? text.empty.title.replace(/\?$/, ` ${userName}?`)
    : text.empty.title;

  // Keep the first server/client render deterministic, then randomize on mount.
  const [suggestions, setSuggestions] = useState<string[]>(() =>
    options.slice(0, SUGGESTION_COUNT)
  );

  useEffect(() => {
    setSuggestions(pickRandomSuggestions(options, SUGGESTION_COUNT));
  }, [options]);

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-8 text-center sm:py-16">
      {/* Logo / icon */}
      {/* <div className="mb-6">
        <Image src="/icons/logo-no-bg.png" alt="ChatLDS" width={48} height={48} />
      </div> */}

      <h2 className="text-4xl font-semibold tracking-tight mb-8">{greeting}</h2>
      {/* <p className="text-sm text-muted-foreground max-w-sm mb-8">{text.empty.subtitle}</p> */}

      {/* Suggested prompts */}
      <div className="grid gap-2 w-full max-w-lg">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onSelect(suggestion)}
            className="text-left px-4 py-3 rounded-lg border border-border/60 bg-card/40 text-sm text-muted-foreground hover:text-foreground hover:border-border hover:bg-card transition-all duration-150"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
