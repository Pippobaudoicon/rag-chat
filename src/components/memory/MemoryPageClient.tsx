"use client";

import { useMemo, useState } from "react";
import { BrainIcon, MessageSquareTextIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/components/chat/language-context";
import { formatText, uiText } from "@/components/chat/i18n";

export interface MemorySnapshot {
  profile: {
    profileSummary: string;
    preferences: string[];
    facts: string[];
    feedbackPatterns: string[];
    lastConversationAt: string | Date | null;
    lastProfiledAt: string | Date | null;
    updatedAt: string | Date;
  } | null;
  periods: Array<{
    id: number;
    cadence: string;
    periodStart: string | Date;
    periodEnd: string | Date;
    summary: string;
    conversationCount: number;
    refreshedAt: string | Date;
  }>;
  conversationMemory: {
    summary: string;
    topics: string[];
    preferences: string[];
    messageCount: number;
    lastMessageAt: string | Date | null;
    updatedAt: string | Date;
  } | null;
}

interface MemoryRefreshResult {
  enabled: boolean;
  conversationsScanned: number;
  conversationsUpdated: number;
  conversationsSkipped: number;
  conversationsFailed: number;
  periodsUpdated: number;
}

type MemoryPageClientProps = {
  snapshot: MemorySnapshot;
};

function formatDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function MemoryList({ title, items }: { title: string; items: string[] }) {
  const visibleItems = items.filter(Boolean);
  if (visibleItems.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {visibleItems.map((item) => (
          <Badge
            key={item}
            variant="outline"
            className="h-auto max-w-full whitespace-normal py-1 text-left leading-snug"
          >
            {item}
          </Badge>
        ))}
      </div>
    </section>
  );
}

function EmptyMemory({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-5 py-12 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function RefreshSummary({ result }: { result: MemoryRefreshResult }) {
  const { language } = useLanguage();
  const text = uiText(language).memory;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-muted-foreground">
      {result.conversationsFailed > 0
        ? formatText(text.refreshFailed, { count: result.conversationsScanned })
        : result.conversationsSkipped > 0
          ? formatText(text.refreshSkipped, { count: result.conversationsScanned })
          : result.conversationsUpdated > 0
            ? formatText(text.refreshUpdated, { count: result.conversationsScanned })
            : formatText(text.refreshEmpty, { count: result.conversationsScanned })}{" "}
      {result.periodsUpdated === 1
        ? text.oneRollupUpdated
        : formatText(text.rollupsUpdated, { count: result.periodsUpdated })}
    </div>
  );
}

export function MemoryPageClient({ snapshot: initialSnapshot }: MemoryPageClientProps) {
  const { language } = useLanguage();
  const text = uiText(language).memory;
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<MemoryRefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasProfileMemory = useMemo(
    () =>
      Boolean(
        snapshot.profile?.profileSummary ||
          snapshot.profile?.preferences.length ||
          snapshot.profile?.facts.length ||
          snapshot.profile?.feedbackPatterns.length
      ),
    [snapshot]
  );
  const hasAnyMemory = Boolean(
    hasProfileMemory || snapshot.periods.length || snapshot.conversationMemory
  );

  async function refreshMemory() {
    setRefreshing(true);
    setError(null);
    setRefreshResult(null);
    try {
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error(`Memory refresh failed with status ${response.status}`);

      const data = (await response.json()) as {
        result: MemoryRefreshResult;
        snapshot: MemorySnapshot;
      };
      setRefreshResult(data.result);
      setSnapshot(data.snapshot);
    } catch (err) {
      console.error("Failed to refresh memory", err);
      setError(text.refreshError);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6 md:px-8">
        <header className="flex flex-col gap-4 rounded-lg border border-border/60 bg-card p-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <BrainIcon className="h-3.5 w-3.5" />
              <span>{text.button}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{text.title}</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {text.description}
            </p>
          </div>
          <button
            type="button"
            onClick={refreshMemory}
            disabled={refreshing}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-border/60 bg-background px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <RefreshCwIcon className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {text.refresh}
          </button>
        </header>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {refreshResult && <RefreshSummary result={refreshResult} />}

        {!hasAnyMemory ? (
          <EmptyMemory label={text.empty} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="space-y-4">
              {hasProfileMemory && snapshot.profile && (
                <section className="rounded-lg border border-border/60 bg-card p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">{text.profile}</h2>
                    {formatDate(snapshot.profile.updatedAt) && (
                      <span className="text-xs text-muted-foreground">
                        {text.updated} {formatDate(snapshot.profile.updatedAt)}
                      </span>
                    )}
                  </div>
                  {snapshot.profile.profileSummary && (
                    <p className="mt-3 whitespace-pre-wrap wrap-break-word text-sm leading-6 text-foreground/90">
                      {snapshot.profile.profileSummary}
                    </p>
                  )}
                  <div className="mt-5 space-y-4">
                    <MemoryList title={text.preferences} items={snapshot.profile.preferences} />
                    <MemoryList title={text.facts} items={snapshot.profile.facts} />
                    <MemoryList title={text.feedback} items={snapshot.profile.feedbackPatterns} />
                  </div>
                </section>
              )}

              {snapshot.conversationMemory && (
                <section className="rounded-lg border border-border/60 bg-card p-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <MessageSquareTextIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-semibold">{text.recentConversations}</h2>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>
                          {snapshot.conversationMemory.messageCount}{" "}
                          {snapshot.conversationMemory.messageCount === 1
                            ? text.oneMessageSummarized
                            : text.messagesSummarized}
                        </span>
                        {formatDate(snapshot.conversationMemory.updatedAt) && (
                          <span>
                            {text.updated} {formatDate(snapshot.conversationMemory.updatedAt)}
                          </span>
                        )}
                      </div>
                      <p className="mt-3 whitespace-pre-wrap wrap-break-word text-sm leading-6 text-foreground/90">
                        {snapshot.conversationMemory.summary}
                      </p>
                      {snapshot.conversationMemory.topics.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {snapshot.conversationMemory.topics.map((topic) => (
                            <Badge
                              key={topic}
                              variant="outline"
                              className="h-auto max-w-full whitespace-normal wrap-break-word py-1 text-left leading-snug"
                            >
                              {topic}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}
            </div>

            {snapshot.periods.length > 0 && (
              <section className="space-y-3 rounded-lg border border-border/60 bg-card p-5">
                <div className="flex items-center gap-2">
                  <SparklesIcon className="h-4 w-4 text-primary" />
                  <h2 className="text-base font-semibold">{text.weeklyMonthly}</h2>
                </div>
                <div className="space-y-3">
                  {snapshot.periods.map((period) => (
                    <article key={period.id} className="rounded-md border border-border/50 bg-background p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="capitalize">
                          {period.cadence}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {period.conversationCount}{" "}
                          {period.conversationCount === 1 ? text.conversation : text.conversations}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-foreground/90">
                        {period.summary}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
