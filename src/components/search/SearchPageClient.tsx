"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightIcon,
  BookOpenIcon,
  ExternalLinkIcon,
  GaugeIcon,
  Layers3Icon,
  SearchIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SettingsPanel } from "@/components/chat/SettingsPanel";
import { cn } from "@/lib/utils";
import {
  ALL_SOURCES,
  DEFAULT_SOURCES,
  SOURCE_COLORS,
  SUPER_SOURCES,
} from "@/lib/types";
import type { CorpusLanguage, SourceChunk, SourceType, UiLanguage } from "@/lib/types";
import { useLanguage } from "@/components/chat/language-context";
import {
  SOURCE_LANGUAGE_NAMES,
  formatText,
  sourceLabel,
  uiText,
} from "@/components/chat/i18n";

const SourceCardDialog = lazy(() => import("@/components/chat/SourceCardDialog"));

type SearchResponse = {
  query: string;
  searchQuery: string;
  chunks: SourceChunk[];
  plan: "free" | "pro";
  requestedTopK: number;
  effectiveTopK: number;
  language: UiLanguage;
  inputLanguage: {
    code: string;
    name: string;
  };
  indexLanguage: CorpusLanguage;
};

type SearchError = {
  error?: string;
  issues?: Array<{ path: string; message: string }>;
  upgradeUrl?: string | null;
};

const TOP_K_OPTIONS = [6, 10, 20] as const;

function arraysEqual(a: SourceType[], b: SourceType[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function validStoredSources(value: string | null): SourceType[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as string[];
    const valid = SUPER_SOURCES as string[];
    const filtered = parsed.filter((source) => valid.includes(source)) as SourceType[];
    return filtered.length > 0 ? filtered : null;
  } catch {
    return null;
  }
}

function chunkTitle(chunk: SourceChunk, fallback: string): string {
  if (chunk.title) return chunk.title;
  if (chunk.book) {
    return `${chunk.book}${chunk.chapter ? ` ${chunk.chapter}` : ""}${chunk.verse ? `:${chunk.verse}` : ""}`;
  }
  if (chunk.section) return chunk.section;
  return fallback;
}

function chunkMeta(chunk: SourceChunk): string {
  const parts = [
    chunk.speaker,
    chunk.date,
    chunk.section,
    chunk.language ? SOURCE_LANGUAGE_NAMES[chunk.language] : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function scoreTone(score: number): string {
  if (score >= 0.78) return "from-emerald-400 to-cyan-300";
  if (score >= 0.62) return "from-cyan-400 to-sky-300";
  return "from-amber-300 to-orange-300";
}

function ResultCard({
  chunk,
  index,
  language,
}: {
  chunk: SourceChunk;
  index: number;
  language: UiLanguage;
}) {
  const [open, setOpen] = useState(false);
  const text = uiText(language);
  const searchText = text.search;
  const label = sourceLabel(chunk.source, language);
  const scorePercent = Math.round(chunk.score * 100);
  const meta = chunkMeta(chunk);

  return (
    <>
      <article className="group relative overflow-hidden rounded-lg border border-border/50 bg-card/50 p-3 text-sm transition-colors hover:border-border hover:bg-card/80">
        <div
          className={cn(
            "absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r opacity-70",
            scoreTone(chunk.score)
          )}
        />
        <div className="relative flex h-full flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                  SOURCE_COLORS[chunk.source]
                )}
              >
                {label}
              </span>
              <span className="text-[10px] text-muted-foreground">
                #{index + 1}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
              <GaugeIcon className="h-3 w-3" />
              <span>{scorePercent}%</span>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="line-clamp-2 text-sm font-medium leading-snug text-foreground/90">
              {chunkTitle(chunk, searchText.sourceExcerpt)}
            </h2>
            {meta && <p className="line-clamp-1 text-[11px] text-muted-foreground">{meta}</p>}
            <p className="line-clamp-4 text-xs leading-relaxed text-muted-foreground">{chunk.text}</p>
          </div>

          <div className="mt-auto flex items-center justify-between gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
              className="h-7 border-border/60 bg-background/50 px-2 text-xs text-muted-foreground hover:bg-card hover:text-foreground"
            >
              <BookOpenIcon className="h-3.5 w-3.5" />
              {searchText.inspect}
            </Button>
            {chunk.url && (
              <a
                href={chunk.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-300 transition-colors hover:text-indigo-200"
              >
                {text.sources.open}
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </article>

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

export function SearchPageClient() {
  const { language } = useLanguage();
  const text = uiText(language);
  const searchText = text.search;
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<SourceType[]>(DEFAULT_SOURCES);
  const [topK, setTopK] = useState<(typeof TOP_K_OPTIONS)[number]>(10);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const isSuperActive = arraysEqual(sources, SUPER_SOURCES);
  const visibleSources = isSuperActive ? SUPER_SOURCES : sources;
  const hasResult = !!result && result.chunks.length > 0;

  const sourceSummary = useMemo(() => {
    if (isSuperActive) return searchText.superCorpus;
    return sources.map((source) => sourceLabel(source, language)).join(", ");
  }, [isSuperActive, language, searchText.superCorpus, sources]);

  useEffect(() => {
    const stored = validStoredSources(window.localStorage.getItem("chat:sources"));
    if (stored) setSources(stored);

    const params = new URLSearchParams(window.location.search);
    const initialQuery = params.get("q");
    if (initialQuery) {
      setQuery(initialQuery);
      void runSearch(initialQuery, stored ?? DEFAULT_SOURCES, topK, false);
    }

    return () => {
      abortRef.current?.abort();
    };
    // The first search intentionally uses initial state only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.localStorage.setItem("chat:sources", JSON.stringify(sources));
  }, [sources]);

  async function runSearch(
    rawQuery = query,
    selectedSources = sources,
    selectedTopK = topK,
    syncUrl = true
  ) {
    const trimmed = rawQuery.trim();
    if (!trimmed) {
      setError(searchText.enterQuery);
      return;
    }

    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    setLoading(true);
    setError(null);

    if (syncUrl) {
      const params = new URLSearchParams({ q: trimmed });
      window.history.replaceState(null, "", `/search?${params.toString()}`);
    }

    try {
      const params = new URLSearchParams({
        q: trimmed,
        language,
        sources: selectedSources.join(","),
        topK: String(selectedTopK),
      });
      const response = await fetch(`/api/search?${params.toString()}`, {
        cache: "no-store",
        signal: abortController.signal,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as SearchError | null;
        if (payload?.issues?.length) {
          throw new Error(payload.issues.map((issue) => issue.message).join(" "));
        }
        throw new Error(payload?.error ?? `${searchText.searchFailed} (${response.status})`);
      }

      setResult((await response.json()) as SearchResponse);
    } catch (searchError) {
      if (searchError instanceof DOMException && searchError.name === "AbortError") return;
      setError(searchError instanceof Error ? searchError.message : searchText.searchFailed);
      setResult(null);
    } finally {
      if (abortRef.current === abortController) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <SettingsPanel
        language={language}
        sources={sources}
        onSourcesChange={setSources}
        disabled={loading}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          <header className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10">
              <SearchIcon className="h-6 w-6 text-indigo-400" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {searchText.title}
              </h1>
              <p className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground">
                {searchText.description}
              </p>
            </div>
          </header>

        <section className="rounded-xl border border-border/60 bg-card/50 p-3 shadow-sm">
          <form onSubmit={submitSearch} className="space-y-4">
            <div className="rounded-lg border border-border/50 bg-background/70 p-3">
              <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <SearchIcon className="h-3.5 w-3.5 text-indigo-400" />
                <span className="font-mono">/api/search</span>
                <span className="ml-auto hidden sm:inline">{searchText.authenticatedRetrieval}</span>
              </div>
              <Textarea
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void runSearch();
                  }
                }}
                placeholder={searchText.placeholder}
                className="min-h-24 resize-none border-0 bg-transparent px-1 text-base leading-7 text-foreground shadow-none outline-none placeholder:text-muted-foreground/70 focus-visible:ring-0 md:text-lg"
                disabled={loading}
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{searchText.topK}</span>
                <div className="flex rounded-lg border border-border/50 bg-background/70 p-1">
                  {TOP_K_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setTopK(option)}
                      disabled={loading}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                        topK === option
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={loading}
                  className="h-9 px-4"
                >
                  {loading ? searchText.searching : searchText.search}
                  <ArrowRightIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-border/50 pt-4">
            {searchText.examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setQuery(example);
                  void runSearch(example);
                }}
                disabled={loading}
                className="rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {result && (
          <section className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border/50 bg-card/40 p-3">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Layers3Icon className="h-3.5 w-3.5" />
                {searchText.results}
              </p>
              <p className="mt-2 text-xl font-semibold text-foreground">{result.chunks.length}</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-card/40 p-3">
              <p className="text-xs text-muted-foreground">{searchText.translatedQuery}</p>
              <p className="mt-2 line-clamp-2 text-xs text-foreground/80">{result.searchQuery}</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-card/40 p-3">
              <p className="text-xs text-muted-foreground">{searchText.detectedLanguage}</p>
              <p className="mt-2 text-xs text-foreground/80">{result.inputLanguage.name}</p>
            </div>
            <div className="rounded-lg border border-border/50 bg-card/40 p-3">
              <p className="text-xs text-muted-foreground">{searchText.surface}</p>
              <p className="mt-2 line-clamp-2 text-xs text-foreground/80">{sourceSummary}</p>
            </div>
          </section>
        )}

        {loading && (
          <section className="grid gap-2 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-36 animate-pulse rounded-lg border border-border/50 bg-card/40"
              />
            ))}
          </section>
        )}

        {!loading && hasResult && (
          <section className="grid gap-2 md:grid-cols-2">
            {result.chunks.map((chunk, index) => (
              <ResultCard
                key={`${chunk.id}-${index}`}
                chunk={chunk}
                index={index}
                language={language}
              />
            ))}
          </section>
        )}

        {!loading && result && result.chunks.length === 0 && (
          <section className="rounded-xl border border-border/60 bg-card/40 px-6 py-10 text-center">
            <p className="text-sm font-medium text-foreground">{searchText.noResultsTitle}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {searchText.noResultsDescription}
            </p>
          </section>
        )}

        {!loading && !result && !error && (
          <section className="rounded-xl border border-dashed border-border/70 bg-card/20 px-6 py-10 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {searchText.readyTitle}
            </p>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              {searchText.readyDescription}
            </p>
          </section>
        )}

        {visibleSources.length > ALL_SOURCES.length && (
          <p className="pb-6 text-center text-xs text-muted-foreground">
            {formatText(searchText.superModeNotice, { count: visibleSources.length })}
          </p>
        )}
        </div>
      </main>
    </div>
  );
}
