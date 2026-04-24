"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { LanguageProvider } from "@/components/chat/language-context";
import { LanguageToggle } from "@/components/chat/LanguageToggle";

const Sheet = lazy(() =>
  import("@/components/ui/sheet").then((m) => ({ default: m.Sheet }))
);
const SheetContent = lazy(() =>
  import("@/components/ui/sheet").then((m) => ({ default: m.SheetContent }))
);

interface AppShellProps {
  children: React.ReactNode;
}

const MOBILE_BREAKPOINT_PX = 768;
const EDGE_SWIPE_MIN_DISTANCE = 50;
const EDGE_SWIPE_MAX_VERTICAL_DRIFT = 60;

export function AppShell({ children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const edgeZoneRef = useRef<HTMLDivElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const node = edgeZoneRef.current;
    if (!node || typeof window === "undefined") {
      return;
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (window.innerWidth >= MOBILE_BREAKPOINT_PX || mobileOpen) {
        swipeStartRef.current = null;
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const start = swipeStartRef.current;
      if (!start) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const deltaX = touch.clientX - start.x;
      const deltaY = Math.abs(touch.clientY - start.y);

      if (deltaY > EDGE_SWIPE_MAX_VERTICAL_DRIFT || deltaX < -12) {
        swipeStartRef.current = null;
        return;
      }
      if (deltaX >= EDGE_SWIPE_MIN_DISTANCE) {
        setMobileOpen(true);
        swipeStartRef.current = null;
      }
    };

    const resetSwipe = () => {
      swipeStartRef.current = null;
    };

    node.addEventListener("touchstart", handleTouchStart, { passive: true });
    node.addEventListener("touchmove", handleTouchMove, { passive: true });
    node.addEventListener("touchend", resetSwipe, { passive: true });
    node.addEventListener("touchcancel", resetSwipe, { passive: true });

    return () => {
      node.removeEventListener("touchstart", handleTouchStart);
      node.removeEventListener("touchmove", handleTouchMove);
      node.removeEventListener("touchend", resetSwipe);
      node.removeEventListener("touchcancel", resetSwipe);
    };
  }, [mobileOpen]);

  return (
    <LanguageProvider>
    <div className="flex h-dvh w-full overflow-hidden bg-background overscroll-none">
      {/* Edge swipe capture zone (mobile only). Positioned past the system
          back-gesture inset so Android/iOS don't swallow the touch first.
          touch-action: pan-y lets vertical scrolling pass through. */}
      <div
        ref={edgeZoneRef}
        aria-hidden
        className="md:hidden fixed top-0 bottom-0 z-40"
        style={{
          left: "max(24px, env(safe-area-inset-left))",
          width: "28px",
          touchAction: "pan-y",
        }}
      />

      {/* Desktop sidebar — fixed, always visible */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col">
        <ChatSidebar />
      </aside>

      {/* Main column: mobile top bar + page content */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Mobile top bar — participates in flex layout (no absolute) so it
            cannot overlap the language selector or the notch. */}
        <header
          className="md:hidden flex items-center gap-3 border-b border-border/40 bg-background/95 backdrop-blur-sm
                     pl-[max(0.75rem,env(safe-area-inset-left))]
                     pr-[max(0.75rem,env(safe-area-inset-right))]
                     pt-[max(0.5rem,env(safe-area-inset-top))]
                     pb-2"
        >
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-6 w-6 shrink-0 rounded bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <svg className="h-3.5 w-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <span className="text-sm font-semibold tracking-tight truncate">LDS RAG</span>
          </div>
          <div className="ml-auto shrink-0">
            <LanguageToggle />
          </div>
        </header>

        {/* Mobile sidebar sheet */}
        <div className="md:hidden">
          <Suspense>
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetContent
                side="left"
                showCloseButton={false}
                className="w-[min(18rem,85vw)] border-border/40 bg-sidebar p-0"
              >
                <SidebarSwipeClose onClose={() => setMobileOpen(false)}>
                  <ChatSidebar
                    onClose={() => setMobileOpen(false)}
                    showMobileClose
                  />
                </SidebarSwipeClose>
              </SheetContent>
            </Sheet>
          </Suspense>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      </main>
    </div>
    </LanguageProvider>
  );
}

const CLOSE_SWIPE_MIN_DISTANCE = 60;
const CLOSE_SWIPE_MAX_VERTICAL_DRIFT = 80;

function SidebarSwipeClose({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    startRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start) return;
    const touch = event.touches[0];
    if (!touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = Math.abs(touch.clientY - start.y);
    if (deltaY > CLOSE_SWIPE_MAX_VERTICAL_DRIFT || deltaX > 12) {
      startRef.current = null;
      return;
    }
    if (-deltaX >= CLOSE_SWIPE_MIN_DISTANCE) {
      startRef.current = null;
      onClose();
    }
  };

  const reset = () => {
    startRef.current = null;
  };

  return (
    <div
      className="flex h-full w-full flex-col"
      style={{ touchAction: "pan-y" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={reset}
      onTouchCancel={reset}
    >
      {children}
    </div>
  );
}
