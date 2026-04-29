"use client";

import { useEffect, useState } from "react";
import { BrainIcon, RefreshCwIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface MemorySnapshot {
  profile: {
    profileSummary: string;
    preferences: string[];
    facts: string[];
    feedbackPatterns: string[];
    lastConversationAt: string | null;
    lastProfiledAt: string | null;
    updatedAt: string;
  } | null;
  periods: Array<{
    id: number;
    cadence: string;
    periodStart: string;
    periodEnd: string;
    summary: string;
    conversationCount: number;
    refreshedAt: string;
  }>;
  conversations: Array<{
    conversationId: string;
    title: string | null;
    summary: string;
    topics: string[];
    preferences: string[];
    lastMessageAt: string | null;
    updatedAt: string;
  }>;
}

interface MemoryRefreshResult {
  enabled: boolean;
  conversationsScanned: number;
  conversationsUpdated: number;
  conversationsSkipped: number;
  periodsUpdated: number;
}

function formatDate(value: string | null | undefined) {
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
          <Badge key={item} variant="outline" className="h-auto max-w-full whitespace-normal py-1 text-left leading-snug">
            {item}
          </Badge>
        ))}
      </div>
    </section>
  );
}

function EmptyMemory() {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
      No saved profile memory yet.
    </div>
  );
}

export function MemoryDialog() {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<MemoryRefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMemory() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/memory", { cache: "no-store" });
      if (!response.ok) throw new Error(`Memory request failed with status ${response.status}`);
      setSnapshot((await response.json()) as MemorySnapshot);
    } catch (err) {
      console.error("Failed to load memory", err);
      setError("Unable to load memory right now.");
    } finally {
      setLoading(false);
    }
  }

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
      setError("Unable to refresh memory right now.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (open) void loadMemory();
  }, [open]);

  const hasProfileMemory = Boolean(
    snapshot?.profile?.profileSummary ||
      snapshot?.profile?.preferences.length ||
      snapshot?.profile?.facts.length ||
      snapshot?.profile?.feedbackPatterns.length
  );
  const hasAnyMemory = Boolean(
    hasProfileMemory || snapshot?.periods.length || snapshot?.conversations.length
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-border/40 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-border/60 hover:bg-accent hover:text-foreground"
      >
        <BrainIcon className="h-3.5 w-3.5" />
        Memory
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3 pr-8">
              <DialogTitle className="text-sm">User memory</DialogTitle>
              <button
                type="button"
                onClick={refreshMemory}
                disabled={loading || refreshing}
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/50 px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <RefreshCwIcon className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
            <DialogDescription className="text-xs">
              Profile notes, preferences, feedback patterns, and compact conversation memories saved for personalization.
            </DialogDescription>
          </DialogHeader>

          {refreshResult && (
            <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              Refreshed {refreshResult.conversationsUpdated} of {refreshResult.conversationsScanned} recent conversations, skipped {refreshResult.conversationsSkipped} already up-to-date, and updated {refreshResult.periodsUpdated} rollup{refreshResult.periodsUpdated === 1 ? "" : "s"}.
            </div>
          )}

          <div className="min-h-0 overflow-y-auto pr-1">
            {loading && !snapshot ? (
              <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-6 text-sm text-muted-foreground">
                <RefreshCwIcon className="h-4 w-4 animate-spin" />
                Loading memory...
              </div>
            ) : error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : !snapshot || !hasAnyMemory ? (
              <EmptyMemory />
            ) : (
              <div className="space-y-5">
                {hasProfileMemory && snapshot.profile && (
                  <section className="space-y-3 rounded-md border border-border/50 bg-muted/10 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">Profile</h3>
                      {formatDate(snapshot.profile.updatedAt) && (
                        <span className="text-xs text-muted-foreground">
                          Updated {formatDate(snapshot.profile.updatedAt)}
                        </span>
                      )}
                    </div>
                    {snapshot.profile.profileSummary && (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                        {snapshot.profile.profileSummary}
                      </p>
                    )}
                    <MemoryList title="Preferences" items={snapshot.profile.preferences} />
                    <MemoryList title="Facts" items={snapshot.profile.facts} />
                    <MemoryList title="Feedback" items={snapshot.profile.feedbackPatterns} />
                  </section>
                )}

                {snapshot.periods.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium">Weekly and monthly summaries</h3>
                    <div className="space-y-2">
                      {snapshot.periods.map((period) => (
                        <article key={period.id} className="rounded-md border border-border/50 bg-muted/10 p-3">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className="capitalize">{period.cadence}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {period.conversationCount} conversation{period.conversationCount === 1 ? "" : "s"}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                            {period.summary}
                          </p>
                        </article>
                      ))}
                    </div>
                  </section>
                )}

                {snapshot.conversations.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium">Recent conversation memories</h3>
                    <div className="space-y-2">
                      {snapshot.conversations.map((conversation) => (
                        <article key={conversation.conversationId} className="rounded-md border border-border/50 bg-muted/10 p-3">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-medium">
                              {conversation.title || "Untitled conversation"}
                            </h4>
                            {formatDate(conversation.updatedAt) && (
                              <span className="text-xs text-muted-foreground">
                                {formatDate(conversation.updatedAt)}
                              </span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                            {conversation.summary}
                          </p>
                          {conversation.topics.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {conversation.topics.map((topic) => (
                                <Badge key={topic} variant="outline">{topic}</Badge>
                              ))}
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
