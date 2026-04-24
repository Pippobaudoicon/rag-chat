"use client";

import { lazy, Suspense, useEffect, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const UserButton = lazy(() =>
  import("@clerk/nextjs").then((m) => ({ default: m.UserButton }))
);

interface ConversationItem {
  id: number;
  title: string | null;
  updatedAt: string;
}

interface ChatSidebarProps {
  onClose?: () => void;
  showMobileClose?: boolean;
}

export function ChatSidebar({ onClose, showMobileClose = false }: ChatSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [currentPath, setCurrentPath] = useState(pathname ?? "/chat");
  // Optimistic active ID — set immediately on click, before the route resolves
  const [pendingId, setPendingId] = useState<number | null>(null);

  async function loadConversations() {
    try {
      const data = await fetch("/api/conversations").then((r) => r.json());
      setConversations(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConversations();
  }, [pathname]); // refresh list on route change (new message auto-titles)

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
      loadConversations();
    };

    window.addEventListener("chat:path-changed", onPathChanged as EventListener);
    window.addEventListener("chat:conversations-changed", onConversationsChanged);

    return () => {
      window.removeEventListener("chat:path-changed", onPathChanged as EventListener);
      window.removeEventListener("chat:conversations-changed", onConversationsChanged);
    };
  }, []);

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

  function handleSelect(id: number) {
    setPendingId(id);
    startTransition(() => {
      router.push(`/chat/${id}`);
      onClose?.();
    });
  }

  async function handleDelete(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (pathname === `/chat/${id}`) {
      router.push("/chat");
    }
  }

  const activeId = currentPath?.match(/\/chat\/(\d+)/)?.[1];

  return (
    <div className="flex flex-col h-full w-full bg-zinc-950 border-r border-border/40">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-4 pb-3 pt-[max(0.75rem,calc(env(safe-area-inset-top)+0.5rem))]">
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
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-zinc-800 transition-colors border border-border/40 hover:border-border/60 disabled:opacity-50"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuova chat
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/50">⌘K</span>
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-0.5 min-h-0">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-md mb-1" />
          ))
        ) : conversations.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground text-center">
            Nessuna conversazione ancora
          </p>
        ) : (
          conversations.map((convo) => {
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
                    ? "bg-zinc-800 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-zinc-800/60"
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
          })
        )}
      </div>

      {/* Footer — account */}
      <div className="border-t border-border/40 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center gap-3">
        <Suspense fallback={<Skeleton className="h-7 w-7 rounded-full" />}>
          <UserButton />
        </Suspense>
        <span className="text-xs text-muted-foreground truncate">Account</span>
      </div>
    </div>
  );
}
