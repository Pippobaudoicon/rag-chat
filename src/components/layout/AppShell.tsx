"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ChatSidebar } from "@/components/chat/ChatSidebar";

const Sheet = lazy(() =>
  import("@/components/ui/sheet").then((m) => ({ default: m.Sheet }))
);
const SheetContent = lazy(() =>
  import("@/components/ui/sheet").then((m) => ({ default: m.SheetContent }))
);
const SheetTrigger = lazy(() =>
  import("@/components/ui/sheet").then((m) => ({ default: m.SheetTrigger }))
);

interface AppShellProps {
  children: React.ReactNode;
}

const MOBILE_BREAKPOINT_PX = 768;
const EDGE_SWIPE_START_MAX_X = 28;
const EDGE_SWIPE_MIN_DISTANCE = 68;
const EDGE_SWIPE_MAX_VERTICAL_DRIFT = 48;

export function AppShell({ children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (window.innerWidth >= MOBILE_BREAKPOINT_PX || mobileOpen) {
        swipeStartRef.current = null;
        return;
      }

      const touch = event.touches[0];
      if (!touch || touch.clientX > EDGE_SWIPE_START_MAX_X) {
        swipeStartRef.current = null;
        return;
      }

      swipeStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
      };
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

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", resetSwipe, { passive: true });
    window.addEventListener("touchcancel", resetSwipe, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", resetSwipe);
      window.removeEventListener("touchcancel", resetSwipe);
    };
  }, [mobileOpen]);

  return (
    <div className="flex h-dvh min-h-svh max-h-dvh overflow-hidden bg-zinc-950 overscroll-none">
      {/* Desktop sidebar — fixed, always visible */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col">
        <ChatSidebar />
      </aside>

      {/* Mobile sidebar — Sheet overlay */}
      <div className="md:hidden absolute top-[max(0.75rem,env(safe-area-inset-top))] left-[max(0.75rem,env(safe-area-inset-left))] z-20">
        <Suspense>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-border/50 bg-zinc-900 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Open menu"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </SheetTrigger>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="w-64 border-border/40 bg-zinc-950 p-0"
            >
              <ChatSidebar
                onClose={() => setMobileOpen(false)}
                showMobileClose
              />
            </SheetContent>
          </Sheet>
        </Suspense>
      </div>

      {/* Main content area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
