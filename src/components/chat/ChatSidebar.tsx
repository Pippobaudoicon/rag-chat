"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { flushSync } from 'react-dom';

import {
  BadgeCheckIcon,
  BrainIcon,
  CircleHelpIcon,
  CreditCardIcon,
  EllipsisVerticalIcon,
  LoaderCircleIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  usePathname,
  useRouter,
} from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { SubscriptionPlan } from '@/lib/billing/entitlements';
import {
  mergeRefreshedConversationFirstPage,
} from '@/lib/chat/client-lifecycle';
import type { ChatGenerationStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  UserButton,
  useUser,
} from '@clerk/nextjs';

import { version } from '../../../package.json';
import { uiText } from './i18n';
import { useLanguage } from './language-context';
import { LanguageToggle } from './LanguageToggle';

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
  generationStatus?: ChatGenerationStatus;
  updatedAt: string;
}

interface ConversationUpdatedDetail {
  id: string;
  title?: string | null;
  generationStatus?: ChatGenerationStatus;
  updatedAt?: string;
}

interface ChatSidebarProps {
  onClose?: () => void;
  showMobileClose?: boolean;
  subscriptionPlan: SubscriptionPlan | null;
}

interface ConversationGroup {
  key: string;
  label: string;
  items: ConversationItem[];
}

type SidebarText = ReturnType<typeof uiText>["sidebar"];

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

function upsertConversationItem(
  conversations: ConversationItem[],
  update: ConversationUpdatedDetail
) {
  const updatedAt = update.updatedAt ?? new Date().toISOString();
  const existing = conversations.find((conversation) => conversation.id === update.id);

  if (!existing) {
    return [
      {
        id: update.id,
        title: update.title ?? null,
        generationStatus: update.generationStatus,
        updatedAt,
      },
      ...conversations,
    ];
  }

  const merged = conversations.map((conversation) =>
    conversation.id === update.id
      ? {
          ...conversation,
          title: update.title === undefined ? conversation.title : update.title,
          generationStatus:
            update.generationStatus === undefined
              ? conversation.generationStatus
              : update.generationStatus,
          updatedAt,
        }
      : conversation
  );

  return merged.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

function groupConversationsByAge(
  conversations: ConversationItem[],
  labels: Pick<SidebarText, "today" | "thisWeek" | "thisMonth" | "older">
): ConversationGroup[] {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

  const today: ConversationItem[] = [];
  const thisWeek: ConversationItem[] = [];
  const thisMonth: ConversationItem[] = [];
  const older: ConversationItem[] = [];

  for (const conversation of conversations) {
    const updatedAt = new Date(conversation.updatedAt).getTime();

    if (updatedAt > oneDayAgo) {
      today.push(conversation);
    } else if (updatedAt > oneWeekAgo) {
      thisWeek.push(conversation);
    } else if (updatedAt > oneMonthAgo) {
      thisMonth.push(conversation);
    } else {
      older.push(conversation);
    }
  }

  return [
    { key: "today", label: labels.today, items: today },
    { key: "this-week", label: labels.thisWeek, items: thisWeek },
    { key: "this-month", label: labels.thisMonth, items: thisMonth },
    { key: "older", label: labels.older, items: older },
  ].filter((group) => group.items.length > 0);
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

export function ChatSidebar({
  onClose,
  showMobileClose = false,
  subscriptionPlan,
}: ChatSidebarProps) {
  const { language } = useLanguage();
  const text = uiText(language);
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
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ConversationItem | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadingPageRef = useRef(false);
  const conversationCountRef = useRef(0);
  const paginationRef = useRef<Pick<ConversationCache, "nextCursor" | "hasMore">>({
    nextCursor: null,
    hasMore: false,
  });
  // Optimistic active ID — set immediately on click, before the route resolves
  const [pendingId, setPendingId] = useState<string | null>(null);
  const cacheKey = user?.id ? `chat:conversations:${user.id}` : null;
  const hasActiveGeneration = conversations.some(
    (conversation) => conversation.generationStatus === "streaming"
  );
  const subscriptionPlanLabel =
    subscriptionPlan === "pro" ? text.billing.proPlan : text.billing.freePlan;

  useEffect(() => {
    conversationCountRef.current = conversations.length;
  }, [conversations.length]);

  useEffect(() => {
    paginationRef.current = { nextCursor, hasMore };
  }, [hasMore, nextCursor]);

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
    preserveLoadedPages = false,
  }: {
    cursor?: string | null;
    replace?: boolean;
    preserveLoadedPages?: boolean;
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
      loadConversations({ replace: true, preserveLoadedPages: true });
    };

    const onConversationUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<ConversationUpdatedDetail>;
      const detail = customEvent.detail;
      if (!detail?.id) return;

      setConversations((prev) => {
        const nextItems = upsertConversationItem(prev, detail);
        persistConversationState(nextItems, nextCursor, hasMore);
        return nextItems;
      });
    };

    window.addEventListener("chat:path-changed", onPathChanged as EventListener);
    window.addEventListener("chat:conversations-changed", onConversationsChanged);
    window.addEventListener("chat:conversation-updated", onConversationUpdated as EventListener);

    return () => {
      window.removeEventListener("chat:path-changed", onPathChanged as EventListener);
      window.removeEventListener("chat:conversations-changed", onConversationsChanged);
      window.removeEventListener("chat:conversation-updated", onConversationUpdated as EventListener);
    };
  }, [hasMore, loadConversations, nextCursor, persistConversationState]);

  // Clear pending selection once the route actually changes
  useEffect(() => {
    setPendingId(null);
  }, [pathname]);

  useEffect(() => {
    if (!hasActiveGeneration) return;
    const interval = window.setInterval(() => {
      void loadConversations({ replace: true, preserveLoadedPages: true });
    }, 2500);
    return () => window.clearInterval(interval);
  }, [hasActiveGeneration, loadConversations]);

  function handleNewChat() {
    // Close the mobile drawer before ChatInterface commits and focuses the new
    // chat, so the keyboard never opens behind a still-visible sheet.
    flushSync(() => {
      setPendingId(null);
      setCurrentPath("/chat");
      onClose?.();
    });
    window.dispatchEvent(new CustomEvent("chat:new-conversation"));
    startTransition(() => {
      router.push("/chat");
    });
  }

  function handleSearch() {
    if (isSearchActive) {
      onClose?.();
      return;
    }

    setPendingId(null);
    setCurrentPath("/search");
    window.dispatchEvent(new CustomEvent("app:navigation-start"));
    onClose?.();
    startTransition(() => {
      router.push("/search");
    });
  }

  function handleSelect(id: string) {
    setPendingId(id);
    startTransition(() => {
      router.push(`/chat/${id}`);
      onClose?.();
    });
  }

  function handlePageNavigation(path: "/memory" | "/billing") {
    if (currentPath === path) {
      onClose?.();
      return;
    }

    setPendingId(null);
    window.dispatchEvent(new CustomEvent("app:navigation-start"));
    onClose?.();
    startTransition(() => {
      router.push(path);
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

  function openRenameDialog(conversation: ConversationItem) {
    setRenameTarget(conversation);
    setRenameDraft(conversation.title ?? "");
    setRenameError(null);
    setMenuOpenId(null);
  }

  async function handleRenameSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameTarget || isRenaming) return;

    const title = renameDraft.trim();
    if (!title) {
      setRenameError(text.sidebar.titleRequired);
      return;
    }

    setIsRenaming(true);
    setRenameError(null);

    try {
      const response = await fetch(`/api/conversations/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });

      if (!response.ok) {
        throw new Error(`Rename failed with status ${response.status}`);
      }

      const updated = (await response.json()) as ConversationItem;
      setConversations((prev) => {
        const nextItems = upsertConversationItem(prev, {
          id: updated.id,
          title: updated.title,
          updatedAt: updated.updatedAt,
        });
        persistConversationState(nextItems, nextCursor, hasMore);
        return nextItems;
      });
      setRenameTarget(null);
      setRenameDraft("");
    } catch (error) {
      console.error("Failed to rename conversation", error);
      setRenameError(text.sidebar.renameError);
    } finally {
      setIsRenaming(false);
    }
  }

  const activeId = currentPath?.match(/\/chat\/([^/]+)/)?.[1];
  const isSearchActive = currentPath === "/search" || currentPath?.startsWith("/search?");
  const conversationGroups = groupConversationsByAge(conversations, text.sidebar);
  const replayTutorial = useCallback(() => {
    onClose?.();

    if (currentPath === "/chat" || currentPath?.startsWith("/chat/")) {
      requestAnimationFrame(() =>
        window.dispatchEvent(new CustomEvent("onboarding:replay"))
      );
      return;
    }

    sessionStorage.setItem("onboarding:replay-after-navigation", "1");
    router.push("/chat");
  }, [currentPath, onClose, router]);

  return (
    <div className="flex flex-col h-full w-full bg-sidebar border-r border-border/40">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-4 pb-1.5 pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.5rem))]">
        <div
          role="link"
          tabIndex={0}
          onClick={handleNewChat}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleNewChat();
            }
          }}
          className="flex cursor-pointer items-center gap-2 min-w-0 px-1 py-0.5"
          aria-label={text.sidebar.newChat}
          title={text.sidebar.newChat}
        >
            {/* FUTURE LOGO (still ugly) */}
            {/* <Image src="/icons/logo-no-bg.png" alt="ChatLDS" width={24} height={24} className="shrink-0" /> */}
            
            {/* TEMP LOGO */}
            <div className="h-6 w-6 shrink-0 rounded bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <svg className="h-3.5 w-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <span className="text-sm font-semibold tracking-tight truncate">ChatLDS</span>
        </div>
        <span className="text-[9px] text-muted-foreground/50">v{version}</span>
        {showMobileClose && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={text.app.closeSidebar}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/50 text-muted-foreground transition-colors hover:text-foreground"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Conversation controls + history — highlighted together by the final
          onboarding step so the tour explains the full sidebar workflow. */}
      <div data-tour="new-chat" className="flex min-h-0 flex-1 flex-col">
        {/* Primary navigation */}
        <div className="flex items-center gap-2 px-3 py-3">
          <button
            onClick={handleNewChat}
            disabled={isPending}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/40 px-3 py-2 text-sm transition-colors hover:border-border/60 disabled:opacity-50",
              currentPath === "/chat"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {text.sidebar.newChat}
            {/* <span className="ml-auto font-mono text-[10px] text-muted-foreground/50">⌘K</span> */}
          </button>
          <button
            type="button"
            onClick={handleSearch}
            onPointerEnter={() => router.prefetch("/search")}
            onFocus={() => router.prefetch("/search")}
            disabled={isPending}
            aria-label={text.sidebar.search}
            title={text.sidebar.search}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/40 text-muted-foreground transition-colors hover:border-border/60 hover:bg-accent hover:text-foreground disabled:opacity-50",
              isSearchActive
                ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                : "text-muted-foreground"
            )}
          >
            <SearchIcon className="h-4 w-4" />
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
            {text.sidebar.noConversations}
          </p>
        ) : (
          <>
            {conversationGroups.map((group) => (
              <div key={group.key} className="space-y-0.5">
                <div className="px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {group.label}
                </div>
                {group.items.map((convo) => {
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
                          <span className="italic text-muted-foreground/60">{text.sidebar.untitledChat}</span>
                        )}
                      </span>
                      {convo.generationStatus === "streaming" && (
                        <LoaderCircleIcon
                          aria-label={text.chat.pendingDrafting}
                          className="h-3.5 w-3.5 shrink-0 animate-spin text-primary"
                        />
                      )}
                      <DropdownMenu
                        open={menuOpenId === convo.id}
                        onOpenChange={(open) => setMenuOpenId(open ? convo.id : null)}
                      >
                        <DropdownMenuTrigger
                          render={
                            <button
                              type="button"
                              aria-label={text.sidebar.actions}
                              className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[popup-open]:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent/80 hover:text-foreground"
                              onClick={(event) => event.stopPropagation()}
                            />
                          }
                        >
                          <EllipsisVerticalIcon className="h-3.5 w-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            onClick={(event) => {
                              event.stopPropagation();
                              openRenameDialog(convo);
                            }}
                          >
                            <PencilIcon className="h-3.5 w-3.5" />
                            {text.sidebar.rename}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={(event) => {
                              void handleDelete(event as unknown as React.MouseEvent, convo.id);
                            }}
                          >
                            <Trash2Icon className="h-3.5 w-3.5" />
                            {text.sidebar.delete}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
              </div>
            ))}
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
      </div>

      {/* Footer — account + language + memory + billing */}
      <div className="pb-safe border-t border-border/40 px-3 py-3">
        <div className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1">
          <span className="shrink-0">
            <UserButton>
              <UserButton.MenuItems>
                <UserButton.Action
                  label={text.onboarding.replayLabel}
                  labelIcon={<CircleHelpIcon className="h-4 w-4" />}
                  onClick={replayTutorial}
                />
              </UserButton.MenuItems>
            </UserButton>
          </span>
          {subscriptionPlan ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`${text.billing.currentPlan}: ${subscriptionPlanLabel}`}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full transition-colors",
                      subscriptionPlan === "pro"
                        ? "text-indigo-400 hover:bg-indigo-500/20"
                        : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {subscriptionPlan === "pro" ? (
                      <BadgeCheckIcon className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                    ) : null}
                  </button>
                }
              />
              <TooltipContent side="top" className="text-xs">
                {`${text.billing.currentPlan}: ${subscriptionPlanLabel}`}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Skeleton className="h-6 w-11 rounded-full" />
          )}
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {/* Language — desktop only; on mobile it lives in the top bar. */}
            <LanguageToggle iconOnly className="hidden md:inline-flex" />
            <span
              data-tour="memory"
              className="-m-1 flex shrink-0 rounded-xl border border-transparent p-1"
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => handlePageNavigation("/memory")}
                      onPointerEnter={() => router.prefetch("/memory")}
                      onFocus={() => router.prefetch("/memory")}
                      disabled={isPending}
                      aria-label={text.memory.button}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                      <BrainIcon className="h-4 w-4" />
                    </button>
                  }
                />
                <TooltipContent side="top" className="text-xs">
                  {text.memory.button}
                </TooltipContent>
              </Tooltip>
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => handlePageNavigation("/billing")}
                    onPointerEnter={() => router.prefetch("/billing")}
                    onFocus={() => router.prefetch("/billing")}
                    disabled={isPending}
                    aria-label={text.billing.title}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    <CreditCardIcon className="h-4 w-4" />
                  </button>
                }
              />
              <TooltipContent side="top" className="text-xs">
                {text.billing.title}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      <Dialog
        open={!!renameTarget}
        onOpenChange={(open) => {
          if (!open && !isRenaming) {
            setRenameTarget(null);
            setRenameDraft("");
            setRenameError(null);
          }
        }}
      >
        <DialogContent>
          <form className="space-y-4" onSubmit={handleRenameSubmit}>
            <DialogHeader>
              <DialogTitle className="text-sm">{text.sidebar.renameTitle}</DialogTitle>
              <DialogDescription className="text-xs">
                {text.sidebar.renameDescription}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Input
                value={renameDraft}
                maxLength={200}
                placeholder={text.sidebar.titlePlaceholder}
                onChange={(event) => setRenameDraft(event.target.value)}
                disabled={isRenaming}
                autoFocus
              />
              {renameError ? (
                <p className="text-xs text-destructive">{renameError}</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (isRenaming) return;
                  setRenameTarget(null);
                  setRenameDraft("");
                  setRenameError(null);
                }}
              >
                {text.sidebar.cancel}
              </Button>
              <Button type="submit" disabled={isRenaming}>
                {isRenaming ? text.sidebar.saving : text.sidebar.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
