"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  LibraryIcon,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchScopeToggle } from "@/components/chat/interface/SearchScopeToggle";
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

// Same pill as the chat composer's toolbar controls (ResponseStylePicker).
const TOOLBAR_PILL =
  "group inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-popup-open:bg-accent data-popup-open:text-foreground";

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
  const meta = chunkMeta(chunk);

  return (
    <>
      <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card/40 p-4 text-sm transition-colors hover:bg-card">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
              SOURCE_COLORS[chunk.source]
            )}
          >
            {label}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {Math.round(chunk.score * 100)}%
          </span>
        </div>

        <div className="space-y-1.5">
          <h2 className="line-clamp-2 font-medium leading-snug text-foreground">
            {chunkTitle(chunk, searchText.sourceExcerpt)}
          </h2>
          {meta && <p className="line-clamp-1 text-xs text-muted-foreground">{meta}</p>}
          <p className="line-clamp-4 text-[13px] leading-relaxed text-muted-foreground">{chunk.text}</p>
        </div>

        <div className="mt-auto flex items-center gap-1 pt-1">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <BookOpenIcon className="size-3.5" />
            {searchText.inspect}
          </button>
          {chunk.url && (
            <a
              href={chunk.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {text.sources.open}
              <ExternalLinkIcon className="size-3.5" />
            </a>
          )}
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
  const hasResult = !!result && result.chunks.length > 0;
  // Before the first search the page is centered like an empty chat.
  const isIdle = !result && !loading && !error;
  const resultsLabel = searchText.results.toLowerCase();

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

  function toggleSource(source: SourceType) {
    if (sources.includes(source)) {
      // Keep at least one source active
      if (sources.length === 1) return;
      setSources(sources.filter((s) => s !== source));
    } else {
      setSources([...sources, source]);
    }
  }

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
    <div className="h-full overflow-y-auto bg-background">
      <div
        className={cn(
          "mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6",
          isIdle && "min-h-full justify-center pb-[12vh]"
        )}
      >
        {isIdle && (
          <header className="space-y-2 text-center">
            <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {searchText.title}
            </h1>
            <p className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground">
              {searchText.description}
            </p>
          </header>
        )}

        {/* Same card as the chat composer. */}
        <form
          onSubmit={submitSearch}
          className="rounded-3xl border border-border bg-card shadow-[0_8px_30px_-12px_rgb(0_0_0/0.5)]"
        >
          <Textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            enterKeyHint="search"
            placeholder={searchText.placeholder}
            className="field-sizing-content min-h-14 max-h-52 resize-none border-0 bg-transparent px-4 pt-4 pb-1 text-base leading-6 shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0 md:text-[15px] dark:bg-transparent"
          />
          <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2.5">
            <DropdownMenu>
              <DropdownMenuTrigger disabled={loading} className={TOOLBAR_PILL}>
                <LibraryIcon size={14} />
                <span className="max-w-40 truncate">
                  {isSuperActive ? searchText.superCorpus : `${searchText.sources} · ${sources.length}`}
                </span>
                <ChevronDownIcon
                  size={12}
                  className="opacity-60 transition-transform group-data-popup-open:rotate-180"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={8} className="w-56 rounded-2xl p-1.5">
                {ALL_SOURCES.map((source) => (
                  <DropdownMenuCheckboxItem
                    key={source}
                    checked={isSuperActive || sources.includes(source)}
                    disabled={isSuperActive}
                    closeOnClick={false}
                    onCheckedChange={() => toggleSource(source)}
                    className="cursor-pointer rounded-xl px-2.5 py-2 text-sm"
                  >
                    {sourceLabel(source, language)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <SearchScopeToggle
              language={language}
              isSuper={isSuperActive}
              onToggle={() => setSources(isSuperActive ? ALL_SOURCES : [...SUPER_SOURCES])}
              disabled={loading}
            />

            <DropdownMenu>
              <DropdownMenuTrigger disabled={loading} className={TOOLBAR_PILL}>
                <span>
                  {topK} {resultsLabel}
                </span>
                <ChevronDownIcon
                  size={12}
                  className="opacity-60 transition-transform group-data-popup-open:rotate-180"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={8} className="w-40 rounded-2xl p-1.5">
                <DropdownMenuRadioGroup
                  value={String(topK)}
                  onValueChange={(next) => setTopK(Number(next) as (typeof TOP_K_OPTIONS)[number])}
                >
                  {TOP_K_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem
                      key={option}
                      value={String(option)}
                      className="cursor-pointer rounded-xl px-2.5 py-2 text-sm"
                    >
                      {option} {resultsLabel}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              type="submit"
              disabled={loading}
              aria-label={loading ? searchText.searching : searchText.search}
              title={searchText.search}
              className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 disabled:bg-muted disabled:text-muted-foreground md:size-8"
            >
              {loading ? <Spinner /> : <ArrowUpIcon className="size-4" />}
            </button>
          </div>
        </form>

        {isIdle && (
          <div className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
            {searchText.examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setQuery(example);
                  void runSearch(example);
                }}
                className="group flex w-64 shrink-0 snap-start items-start justify-between gap-2 rounded-2xl border border-border bg-card/40 px-3.5 py-3 text-left text-sm leading-snug text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:w-auto"
              >
                <span className="line-clamp-2">{example}</span>
                <ArrowUpRightIcon className="mt-0.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {result && !loading && (
          <p className="px-1 text-xs text-muted-foreground">
            {result.chunks.length} {resultsLabel} · {result.inputLanguage.name} · {sourceSummary}
            {result.searchQuery !== result.query && (
              <>
                {" · "}
                {searchText.translatedQuery}: “{result.searchQuery}”
              </>
            )}
          </p>
        )}

        {loading && (
          <section className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-44 animate-pulse rounded-2xl border border-border bg-card/40"
              />
            ))}
          </section>
        )}

        {!loading && hasResult && (
          <section className="grid gap-3 md:grid-cols-2">
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
          <section className="rounded-2xl border border-border bg-card/40 px-6 py-10 text-center">
            <p className="text-sm font-medium text-foreground">{searchText.noResultsTitle}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {searchText.noResultsDescription}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
