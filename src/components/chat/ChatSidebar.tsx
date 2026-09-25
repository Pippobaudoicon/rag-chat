"use client";

import {
  useCallback,
  useEffect,
  useState,
  useTransition,
} from 'react';
import { flushSync } from 'react-dom';

import {
  PanelLeftCloseIcon,
  SearchIcon,
} from 'lucide-react';
import {
  usePathname,
  useRouter,
} from 'next/navigation';

import { FeatureGate } from '@/components/ui/feature-gate';
import { Skeleton } from '@/components/ui/skeleton';
import type { SubscriptionPlan } from '@/lib/billing/entitlements';
import {
  groupConversationsByAge,
  type ConversationItem,
} from '@/lib/chat/conversation-list';
import { cn } from '@/lib/utils';
import { useUser } from '@clerk/nextjs';

import { version } from '../../../package.json';
import { uiText } from './i18n';
import { useLanguage } from './language-context';
import { ConversationRow } from './sidebar/ConversationRow';
import { RenameConversationDialog } from './sidebar/RenameConversationDialog';
import { SidebarFooter } from './sidebar/SidebarFooter';
import { useConversationList } from './sidebar/useConversationList';

interface ChatSidebarProps {
  onClose?: () => void;
  onCollapse?: () => void;
  showMobileClose?: boolean;
  subscriptionPlan: SubscriptionPlan | null;
}

export function ChatSidebar({
  onClose,
  onCollapse,
  showMobileClose = false,
  subscriptionPlan,
}: ChatSidebarProps) {
  const { language } = useLanguage();
  const text = uiText(language);
  const router = useRouter();
  const pathname = usePathname();
  const { isLoaded, user } = useUser();
  const isGuest = isLoaded && !user;
  const [isPending, startTransition] = useTransition();
  const [currentPath, setCurrentPath] = useState(pathname ?? "/chat");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ConversationItem | null>(null);
  // Remounts the rename dialog per opening, so it starts from that title.
  const [renameKey, setRenameKey] = useState(0);
  // Optimistic active ID — set immediately on click, before the route resolves
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Signed-out visitors chat as a guest (cookie-identified server-side).
  const cacheKey = `chat:conversations:${user?.id ?? "guest"}`;
  const {
    conversations,
    loading,
    loadingMore,
    hasMore,
    listRef,
    loadMoreRef,
    upsertConversation,
    removeConversation,
  } = useConversationList(cacheKey, isLoaded);

  // Follow route changes, and clear the pending selection once the route
  // actually changes (adjusted during render rather than in an effect).
  const [renderedPathname, setRenderedPathname] = useState(pathname);
  if (pathname !== renderedPathname) {
    setRenderedPathname(pathname);
    setCurrentPath(pathname ?? "/chat");
    setPendingId(null);
  }

  useEffect(() => {
    const onPathChanged = (event: Event) => {
      const path = (event as CustomEvent<{ path?: string }>).detail?.path;
      if (path) setCurrentPath(path);
    };
    window.addEventListener("chat:path-changed", onPathChanged);
    return () => window.removeEventListener("chat:path-changed", onPathChanged);
  }, []);

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
    if (isGuest) return;
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
    if (isGuest) return;
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

  async function handleDelete(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    removeConversation(id);
    if (pathname === `/chat/${id}`) {
      router.push("/chat");
    }
  }

  function openRenameDialog(conversation: ConversationItem) {
    setRenameTarget(conversation);
    setRenameKey((key) => key + 1);
    setMenuOpenId(null);
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
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label={text.app.closeSidebar}
            title={text.app.closeSidebar}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelLeftCloseIcon className="h-[18px] w-[18px]" />
          </button>
        )}
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
          <FeatureGate
            locked={isGuest}
            title={text.sidebar.search}
            message={text.sidebar.guestLocked.search}
            action={text.chat.guestUsageAction}
            href="/sign-up"
          >
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
          </FeatureGate>
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
                {group.items.map((convo) => (
                  <ConversationRow
                    key={convo.id}
                    conversation={convo}
                    isActive={
                      pendingId === convo.id ||
                      (!pendingId && String(convo.id) === activeId)
                    }
                    menuOpen={menuOpenId === convo.id}
                    text={text}
                    onSelect={() => handleSelect(convo.id)}
                    onMenuOpenChange={(open) => setMenuOpenId(open ? convo.id : null)}
                    onRename={() => openRenameDialog(convo)}
                    onDelete={() => void handleDelete(convo.id)}
                  />
                ))}
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
      <SidebarFooter
        text={text}
        isGuest={isGuest}
        isPending={isPending}
        subscriptionPlan={subscriptionPlan}
        onReplayTutorial={replayTutorial}
        onNavigate={handlePageNavigation}
      />

      <RenameConversationDialog
        key={renameKey}
        target={renameTarget}
        text={text.sidebar}
        onClose={() => setRenameTarget(null)}
        onRenamed={(updated) => {
          upsertConversation({
            id: updated.id,
            title: updated.title,
            updatedAt: updated.updatedAt,
          });
          setRenameTarget(null);
        }}
      />
    </div>
  );
}
