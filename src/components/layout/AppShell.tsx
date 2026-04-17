"use client";

import { lazy, Suspense, useRef, useState } from "react";
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

export function AppShell({ children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const swipeStartXRef = useRef<number | null>(null);
  const swipeStartYRef = useRef<number | null>(null);
  const swipeHandledRef = useRef(false);

  function resetSwipeGesture() {
    swipeStartXRef.current = null;
    swipeStartYRef.current = null;
    swipeHandledRef.current = false;
  }

  function handleEdgeTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    swipeStartXRef.current = touch.clientX;
    swipeStartYRef.current = touch.clientY;
    swipeHandledRef.current = false;
  }

  function handleEdgeTouchMove(event: React.TouchEvent<HTMLDivElement>) {
    if (mobileOpen || swipeHandledRef.current) return;

    const startX = swipeStartXRef.current;
    const startY = swipeStartYRef.current;
    if (startX === null || startY === null) return;

    const touch = event.touches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = Math.abs(touch.clientY - startY);

    if (deltaX > 56 && deltaY < 48) {
      swipeHandledRef.current = true;
      setMobileOpen(true);
    }
  }

  return (
    <div className="relative flex h-dvh max-h-dvh overflow-hidden bg-zinc-950 overscroll-none">
      {/* Desktop sidebar — fixed, always visible */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col">
        <ChatSidebar />
      </aside>

      {!mobileOpen && (
        <div
          className="absolute inset-y-0 left-0 z-10 w-5 md:hidden"
          aria-hidden="true"
          onTouchStart={handleEdgeTouchStart}
          onTouchMove={handleEdgeTouchMove}
          onTouchEnd={resetSwipeGesture}
          onTouchCancel={resetSwipeGesture}
        />
      )}

      {/* Mobile sidebar — Sheet overlay */}
      <div className="md:hidden absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-20">
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
              className="w-64 border-border/40 bg-zinc-950 p-0 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            >
              <ChatSidebar onClose={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
        </Suspense>
      </div>

      {/* Main content area */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden pt-[calc(max(0.75rem,env(safe-area-inset-top))+3rem)] md:pt-0">
        {children}
      </main>
    </div>
  );
}
