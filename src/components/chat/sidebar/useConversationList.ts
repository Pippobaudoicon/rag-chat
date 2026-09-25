"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { mergeRefreshedConversationFirstPage } from "@/lib/chat/client-lifecycle";
import {
  mergeConversationPages,
  upsertConversationItem,
  type ConversationItem,
  type ConversationUpdatedDetail,
} from "@/lib/chat/conversation-list";

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

/**
 * The sidebar's conversation list: cached in memory + localStorage per user,
 * paged from `/api/conversations` (infinite scroll through `listRef` /
 * `loadMoreRef`), refreshed on `chat:conversations-changed`, patched by
 * `chat:conversation-updated`, and polled while any row is generating.
 */
export function useConversationList(cacheKey: string, isLoaded: boolean) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadingPageRef = useRef(false);
  const conversationCountRef = useRef(0);
  const paginationRef = useRef<Pick<ConversationCache, "nextCursor" | "hasMore">>({
    nextCursor: null,
    hasMore: false,
  });
  const hasActiveGeneration = conversations.some(
    (conversation) => conversation.generationStatus === "streaming"
  );

  useEffect(() => {
    conversationCountRef.current = conversations.length;
  }, [conversations.length]);

  useEffect(() => {
    paginationRef.current = { nextCursor, hasMore };
  }, [hasMore, nextCursor]);

  const persistConversationState = useCallback(
    (items: ConversationItem[], cursor: string | null, more: boolean) => {
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
    preserveLoadedPages = false,
  }: {
    cursor?: string | null;
    replace?: boolean;
    preserveLoadedPages?: boolean;
  } = {}) => {
    if (loadingPageRef.current) return;

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
      const preservePagination =
        preserveLoadedPages &&
        conversationCountRef.current > CONVERSATION_PAGE_SIZE;
      const effectiveNextCursor = preservePagination
        ? paginationRef.current.nextCursor
        : data.nextCursor;
      const effectiveHasMore = preservePagination
        ? paginationRef.current.hasMore
        : data.hasMore;
      setNextCursor(effectiveNextCursor);
      setHasMore(effectiveHasMore);
      setConversations((prev) => {
        const nextItems = replace
          ? preserveLoadedPages
            ? mergeRefreshedConversationFirstPage(
                prev,
                data.items,
                CONVERSATION_PAGE_SIZE
              )
            : data.items
          : mergeConversationPages(prev, data.items);
        persistConversationState(nextItems, effectiveNextCursor, effectiveHasMore);
        return nextItems;
      });
    } finally {
      setLoading(false);
      setLoadingMore(false);
      loadingPageRef.current = false;
    }
  }, [persistConversationState]);

  const loadNextPage = useCallback(() => {
    if (!hasMore || !nextCursor || loadingMore) return;
    loadConversations({ cursor: nextCursor });
  }, [hasMore, loadConversations, loadingMore, nextCursor]);

  const upsertConversation = useCallback(
    (detail: ConversationUpdatedDetail) => {
      setConversations((prev) => {
        const nextItems = upsertConversationItem(prev, detail);
        persistConversationState(nextItems, nextCursor, hasMore);
        return nextItems;
      });
    },
    [hasMore, nextCursor, persistConversationState]
  );

  const removeConversation = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const nextItems = prev.filter((c) => c.id !== id);
        persistConversationState(nextItems, nextCursor, hasMore);
        return nextItems;
      });
    },
    [hasMore, nextCursor, persistConversationState]
  );

  useEffect(() => {
    if (!isLoaded) return;

    // localStorage is only readable after hydration, so the cached list is
    // applied here rather than during render.
    const cached = readConversationCache(cacheKey);
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from localStorage after mount
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
    const onConversationsChanged = () => {
      loadConversations({ replace: true, preserveLoadedPages: true });
    };

    const onConversationUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ConversationUpdatedDetail>).detail;
      if (!detail?.id) return;
      upsertConversation(detail);
    };

    window.addEventListener("chat:conversations-changed", onConversationsChanged);
    window.addEventListener("chat:conversation-updated", onConversationUpdated);

    return () => {
      window.removeEventListener("chat:conversations-changed", onConversationsChanged);
      window.removeEventListener("chat:conversation-updated", onConversationUpdated);
    };
  }, [loadConversations, upsertConversation]);

  useEffect(() => {
    if (!hasActiveGeneration) return;
    const interval = window.setInterval(() => {
      void loadConversations({ replace: true, preserveLoadedPages: true });
    }, 2500);
    return () => window.clearInterval(interval);
  }, [hasActiveGeneration, loadConversations]);

  return {
    conversations,
    loading,
    loadingMore,
    hasMore,
    listRef,
    loadMoreRef,
    upsertConversation,
    removeConversation,
  };
}
