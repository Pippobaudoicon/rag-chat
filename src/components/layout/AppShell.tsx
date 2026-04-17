"use client";

import { lazy, Suspense, useState } from "react";
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

  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden">
      {/* Desktop sidebar — fixed, always visible */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col">
        <ChatSidebar />
      </aside>

      {/* Mobile sidebar — Sheet overlay */}
      <div className="md:hidden absolute top-3 left-3 z-20">
        <Suspense>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 bg-zinc-900 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Open menu"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </SheetTrigger>
            <SheetContent side="left" className="p-0 w-64 bg-zinc-950 border-border/40">
              <ChatSidebar onClose={() => setMobileOpen(false)} />
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
