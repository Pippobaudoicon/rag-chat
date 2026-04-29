"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUser, UserButton } from "@clerk/nextjs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MemoryDialog } from "./MemoryDialog";

const CONVERSATION_PAGE_SIZE = 20;
const CONVERSATION_CACHE_TTL_MS = 2 * 60 * 1000;

interface ConversationCache {
  items: ConversationItem[];
  nextCursor: string | null;
  hasMore: boolean;
  savedAt: number;
}

interface ConversationPage {
  items: ConversationItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

const memoryCache = new Map<string, ConversationCache>();

interface ConversationItem {
  id: string;
  title: string | null;
  updatedAt: string;
}

interface ChatSidebarProps {
  onClose?: () => void;
  showMobileClose?: boolean;
}

function mergeConversationPages(
  existing: ConversationItem[],
  incoming: ConversationItem[]
) {
  const seen = new Set<string>();
  const merged: ConversationItem[] = [];

  for (const conversation of [...existing, ...incoming]) {
    if (seen.has(conversation.id)) continue;
    seen.add(conversation.id);
    merged.push(conversation);
  }

  return merged;
}

function readConversationCache(key: string) {
  const cached = memoryCache.get(key);
  if (cached) return cached;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConversationCache;
    if (!Array.isArray(parsed.items) || typeof parsed.savedAt !== "number") {
      return null;
    }
    memoryCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeConversationCache(key: string, cache: ConversationCache) {
  memoryCache.set(key, cache);
  try {
    window.localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // Storage can be unavailable in private browsing or quota pressure.
  }
}

export function ChatSidebar({ onClose, showMobileClose = false }: ChatSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoaded, user } = useUser();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [currentPath, setCurrentPath] = useState(pathname ?? "/chat");
  const listRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadingPageRef = useRef(false);
  const conversationCountRef = useRef(0);
  // Optimistic active ID — set immediately on click, before the route resolves
  const [pendingId, setPendingId] = useState<string | null>(null);
  const cacheKey = user?.id ? `chat:conversations:${user.id}` : null;

  useEffect(() => {
    conversationCountRef.current = conversations.length;
  }, [conversations.length]);

  const persistConversationState = useCallback(
    (items: ConversationItem[], cursor: string | null, more: boolean) => {
      if (!cacheKey) return;
      writeConversationCache(cacheKey, {
        items,
        nextCursor: cursor,
        hasMore: more,
        savedAt: Date.now(),
      });
    },
    [cacheKey]
  );

  const loadConversations = useCallback(async ({
    cursor = null,
    replace = false,
  }: {
    cursor?: string | null;
    replace?: boolean;
  } = {}) => {
    if (!cacheKey || loadingPageRef.current) return;

    loadingPageRef.current = true;
    if (replace) {
      setLoading(conversationCountRef.current === 0);
    } else {
      setLoadingMore(true);
    }

    try {
      const params = new URLSearchParams({
        limit: String(CONVERSATION_PAGE_SIZE),
      });
      if (cursor) params.set("cursor", cursor);

      const response = await fetch(`/api/conversations?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) return;

      const data = (await response.json()) as ConversationPage;
      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
      setConversations((prev) => {
        const nextItems = replace
          ? data.items
          : mergeConversationPages(prev, data.items);
        persistConversationState(nextItems, data.nextCursor, data.hasMore);
        return nextItems;
      });
    } finally {
      setLoading(false);
      setLoadingMore(false);
      loadingPageRef.current = false;
    }
  }, [cacheKey, persistConversationState]);

  const loadNextPage = useCallback(() => {
    if (!hasMore || !nextCursor || loadingMore) return;
    loadConversations({ cursor: nextCursor });
  }, [hasMore, loadConversations, loadingMore, nextCursor]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!cacheKey) {
      setConversations([]);
      setLoading(false);
      return;
    }

    const cached = readConversationCache(cacheKey);
    if (cached) {
      setConversations(cached.items);
      setNextCursor(cached.nextCursor);
      setHasMore(cached.hasMore);
      setLoading(false);
    }

    if (!cached || Date.now() - cached.savedAt > CONVERSATION_CACHE_TTL_MS) {
      loadConversations({ replace: true });
    }
  }, [cacheKey, isLoaded, loadConversations]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    const root = listRef.current;
    if (!sentinel || !root || !hasMore || loading || loadingMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          loadNextPage();
        }
      },
      { root, rootMargin: "120px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [conversations.length, hasMore, loadNextPage, loading, loadingMore]);

  useEffect(() => {
    setCurrentPath(pathname ?? "/chat");
  }, [pathname]);

  useEffect(() => {
    const onPathChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ path?: string }>;
      if (customEvent.detail?.path) {
        setCurrentPath(customEvent.detail.path);
      }
    };

    const onConversationsChanged = () => {
      loadConversations({ replace: true });
    };

    window.addEventListener("chat:path-changed", onPathChanged as EventListener);
    window.addEventListener("chat:conversations-changed", onConversationsChanged);

    return () => {
      window.removeEventListener("chat:path-changed", onPathChanged as EventListener);
      window.removeEventListener("chat:conversations-changed", onConversationsChanged);
    };
  }, [loadConversations]);

  // Clear pending selection once the route actually changes
  useEffect(() => {
    setPendingId(null);
  }, [pathname]);

  function handleNewChat() {
    setPendingId(null);
    setCurrentPath("/chat");
    window.dispatchEvent(new CustomEvent("chat:new-conversation"));
    startTransition(() => {
      router.push("/chat");
      onClose?.();
    });
  }

  function handleSelect(id: string) {
    setPendingId(id);
    startTransition(() => {
      router.push(`/chat/${id}`);
      onClose?.();
    });
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    setConversations((prev) => {
      const nextItems = prev.filter((c) => c.id !== id);
      persistConversationState(nextItems, nextCursor, hasMore);
      return nextItems;
    });
    if (pathname === `/chat/${id}`) {
      router.push("/chat");
    }
  }

  const activeId = currentPath?.match(/\/chat\/([^/]+)/)?.[1];

  return (
    <div className="flex flex-col h-full w-full bg-sidebar border-r border-border/40">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-4 pb-1.5 pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.5rem))]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-6 w-6 shrink-0 rounded bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
            <svg className="h-3.5 w-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <span className="text-sm font-semibold tracking-tight truncate">LDS RAG</span>
        </div>
        {showMobileClose && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/50 text-muted-foreground transition-colors hover:text-foreground"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* New chat button */}
      <div className="px-3 py-3">
        <button
          onClick={handleNewChat}
          disabled={isPending}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border border-border/40 hover:border-border/60 disabled:opacity-50"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuova chat
          {/* <span className="ml-auto font-mono text-[10px] text-muted-foreground/50">⌘K</span> */}
        </button>
      </div>

      {/* Conversation list */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 pb-3 space-y-0.5 min-h-0">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-md mb-1" />
          ))
        ) : conversations.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground text-center">
            Nessuna conversazione ancora
          </p>
        ) : (
          <>
            {conversations.map((convo) => {
              // Show active state immediately on click (pendingId),
              // fall back to the real URL match (activeId) once loaded
              const isActive =
                pendingId === convo.id ||
                (!pendingId && String(convo.id) === activeId);

              return (
                <div
                  key={convo.id}
                  onClick={() => handleSelect(convo.id)}
                  className={cn(
                    "group flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                  )}
                >
                  <span className="flex-1 truncate text-xs leading-snug">
                    {convo.title ?? (
                      <span className="italic text-muted-foreground/60">Nuova chat</span>
                    )}
                  </span>
                  {/* Delete button — only visible on hover */}
                  <button
                    onClick={(e) => handleDelete(e, convo.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:text-red-400"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}
            {hasMore && (
              <div ref={loadMoreRef} className="space-y-1 py-2">
                {loadingMore ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full rounded-md" />
                  ))
                ) : (
                  <div className="h-6" aria-hidden="true" />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer — memory + account */}
      <div className="pb-safe space-y-2 border-t border-border/40 px-3 py-3">
        <MemoryDialog />
        <div className="flex items-center gap-3 px-1">
          <span>
            <UserButton />
          </span>
          <span className="text-xs text-muted-foreground truncate">Account</span>
        </div>
      </div>
    </div>
  );
}
