"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { LanguageProvider } from "@/components/chat/language-context";
import { LanguageToggle } from "@/components/chat/LanguageToggle";
import { useLanguage } from "@/components/chat/language-context";
import { uiText } from "@/components/chat/i18n";

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
const OPEN_SWIPE_MIN_DISTANCE = 70;
const OPEN_SWIPE_HORIZONTAL_RATIO = 1.5; // |dx| must dominate |dy| by this factor

export function AppShell({ children }: AppShellProps) {
  return (
    <LanguageProvider>
      <AppShellContent>{children}</AppShellContent>
    </LanguageProvider>
  );
}

function AppShellContent({ children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { language } = useLanguage();
  const text = uiText(language);
  const swipeStartRef = useRef<
    | {
        x: number;
        y: number;
        ignore: boolean;
      }
    | null
  >(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isInteractiveTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      // Avoid hijacking gestures over native horizontal scrollers,
      // form controls, sliders, or anything that opts out via data attribute.
      return Boolean(
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="slider"], [data-no-swipe], [data-radix-scroll-area-viewport], .overflow-x-auto, .overflow-x-scroll'
        )
      );
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (window.innerWidth >= MOBILE_BREAKPOINT_PX || mobileOpen) {
        swipeStartRef.current = null;
        return;
      }
      if (event.touches.length > 1) {
        swipeStartRef.current = null;
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      swipeStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        ignore: isInteractiveTarget(event.target),
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const start = swipeStartRef.current;
      if (!start || start.ignore) return;
      const touch = event.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      // Cancel if the gesture turns into a vertical scroll or moves left.
      if (deltaX < -12 || (absY > 16 && absY * OPEN_SWIPE_HORIZONTAL_RATIO > absX)) {
        swipeStartRef.current = null;
        return;
      }
      if (deltaX >= OPEN_SWIPE_MIN_DISTANCE && absX > absY * OPEN_SWIPE_HORIZONTAL_RATIO) {
        setMobileOpen(true);
        swipeStartRef.current = null;
      }
    };

    const resetSwipe = () => {
      swipeStartRef.current = null;
    };

    const opts: AddEventListenerOptions = { passive: true, capture: true };
    window.addEventListener("touchstart", handleTouchStart, opts);
    window.addEventListener("touchmove", handleTouchMove, opts);
    window.addEventListener("touchend", resetSwipe, opts);
    window.addEventListener("touchcancel", resetSwipe, opts);

    return () => {
      window.removeEventListener("touchstart", handleTouchStart, opts);
      window.removeEventListener("touchmove", handleTouchMove, opts);
      window.removeEventListener("touchend", resetSwipe, opts);
      window.removeEventListener("touchcancel", resetSwipe, opts);
    };
  }, [mobileOpen]);

  return (
    <div className="app-shell-height flex w-full overflow-hidden bg-background overscroll-none">
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
            aria-label={text.app.openMenu}
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
