import { useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/types";

const SUGGESTION_COUNT = 3;

const SUGGESTION_OPTIONS_IT = [
  "Qual è lo scopo del sacramento nella Chiesa?",
  "Cosa insegna 2 Nefi 2?",
  "Cosa dice il Manuale generale sui doveri del vescovo?",
  "Come posso prepararmi spiritualmente per la conferenza generale?",
  "Quali insegnamenti ci sono in Alma 32 sulla fede?",
  "Cosa insegna Dottrina e Alleanze 121 sulla leadership?",
  "Come posso studiare le Scritture in modo più efficace?",
  "Cosa insegna Mosia 18 sul battesimo e sulle alleanze?",
  "Qual è il ruolo del consiglio di rione secondo il Manuale generale?",
];

const SUGGESTION_OPTIONS_EN = [
  "What is the purpose of the sacrament in the Church?",
  "What does 2 Nephi 2 teach?",
  "What does the General Handbook say about the bishop's duties?",
  "How can I prepare spiritually for general conference?",
  "What does Alma 32 teach about faith?",
  "What does Doctrine and Covenants 121 teach about leadership?",
  "How can I study the scriptures more effectively?",
  "What does Mosiah 18 teach about baptism and covenants?",
  "What is the role of the ward council according to the General Handbook?",
];

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
}

export function EmptyState({ language, onSelect }: EmptyStateProps) {
  const options = useMemo(
    () => (language === "ita" ? SUGGESTION_OPTIONS_IT : SUGGESTION_OPTIONS_EN),
    [language]
  );

  // Keep the first server/client render deterministic, then randomize on mount.
  const [suggestions, setSuggestions] = useState<string[]>(() =>
    options.slice(0, SUGGESTION_COUNT)
  );

  useEffect(() => {
    setSuggestions(pickRandomSuggestions(options, SUGGESTION_COUNT));
  }, [options]);

  const title =
    language === "ita"
      ? "Come posso aiutarti oggi?"
      : "How can I help you today?";
  const subtitle =
    language === "ita"
      ? "Fai una domanda a LDS helper..."
      : "Ask a question to LDS helper...";

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-8 text-center sm:py-16">
      {/* Logo / icon */}
      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20">
        <svg
          className="h-6 w-6 text-indigo-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
          />
        </svg>
      </div>

      <h2 className="text-xl font-semibold tracking-tight mb-2">{title}</h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-8">{subtitle}</p>

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
