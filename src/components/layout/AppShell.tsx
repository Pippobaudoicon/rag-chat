"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { LoaderCircleIcon } from "lucide-react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { LanguageProvider } from "@/components/chat/language-context";
import { LanguageToggle } from "@/components/chat/LanguageToggle";
import { useLanguage } from "@/components/chat/language-context";
import { uiText } from "@/components/chat/i18n";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import {
  BillingProvider,
  useBillingOverview,
} from "@/components/billing/BillingContext";

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
    <BillingProvider>
      <LanguageProvider>
        <AppShellContent>{children}</AppShellContent>
      </LanguageProvider>
    </BillingProvider>
  );
}

function AppShellContent({ children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tourOwnsSidebar, setTourOwnsSidebar] = useState(false);
  const [navigationPending, setNavigationPending] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { language } = useLanguage();
  const { billingOverview } = useBillingOverview();
  const text = uiText(language);
  const subscriptionPlan =
    billingOverview &&
    (billingOverview.plan === "pro" || billingOverview.billingStatus !== "unavailable")
      ? billingOverview.plan
      : null;
  const swipeStartRef = useRef<
    | {
        x: number;
        y: number;
        ignore: boolean;
      }
    | null
  >(null);

  useEffect(() => {
    const handleNavigationStart = () => setNavigationPending(true);
    window.addEventListener("app:navigation-start", handleNavigationStart);
    return () => window.removeEventListener("app:navigation-start", handleNavigationStart);
  }, []);

  useEffect(() => {
    setNavigationPending(false);
  }, [pathname]);

  useEffect(() => {
    if (!navigationPending) return;
    const timeout = window.setTimeout(() => setNavigationPending(false), 15000);
    return () => window.clearTimeout(timeout);
  }, [navigationPending]);

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

  // The onboarding tour opens/closes the mobile drawer so it can anchor steps
  // to sidebar-only controls.
  useEffect(() => {
    const onSetSidebar = (event: Event) => {
      const open = (event as CustomEvent<{ open?: boolean }>).detail?.open;
      if (typeof open === "boolean") {
        setTourOwnsSidebar(open);
        setMobileOpen(open);
      }
    };
    window.addEventListener("onboarding:set-sidebar", onSetSidebar);
    return () => window.removeEventListener("onboarding:set-sidebar", onSetSidebar);
  }, []);

  const handleNewChatFromLogo = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("chat:new-conversation"));
    router.push("/chat");
  };

  return (
    <div className="app-shell-height flex w-full overflow-hidden bg-background overscroll-none">
      {/* Desktop sidebar — fixed, always visible */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col">
        <ChatSidebar subscriptionPlan={subscriptionPlan} />
      </aside>

      {/* Main column: mobile top bar + page content */}
      <main className="relative flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
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
          <div
            role="link"
            tabIndex={0}
            onClick={handleNewChatFromLogo}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleNewChatFromLogo();
              }
            }}
            className="flex cursor-pointer items-center gap-2 min-w-0 px-1 py-0.5"
            aria-label={text.sidebar.newChat}
            title={text.sidebar.newChat}
          >
            {/* FUTURE LOGO (still ugly) */}
            {/* <Image src="/icons/logo-no-bg.png" alt="ChatLDS" width={24} height={24} className="shrink-0" /> */}
            <span className="text-sm font-semibold tracking-tight truncate">ChatLDS</span>
          </div>
          <div className="ml-auto shrink-0">
            <LanguageToggle />
          </div>
        </header>

        {/* Mobile sidebar sheet */}
        <div className="md:hidden">
          <Suspense>
            <Sheet
              open={mobileOpen}
              modal={tourOwnsSidebar ? false : true}
              onOpenChange={setMobileOpen}
            >
              <SheetContent
                side="left"
                showCloseButton={false}
                className="w-[min(18rem,85vw)] border-border/40 bg-sidebar p-0"
              >
                <SidebarSwipeClose onClose={() => setMobileOpen(false)}>
                  <ChatSidebar
                    onClose={() => setMobileOpen(false)}
                    showMobileClose
                    subscriptionPlan={subscriptionPlan}
                  />
                </SidebarSwipeClose>
              </SheetContent>
            </Sheet>
          </Suspense>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>

        {navigationPending ? (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-[2px]"
          >
            <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/95 px-3 py-2 text-xs font-medium text-foreground shadow-xl">
              <LoaderCircleIcon
                className="h-4 w-4 animate-spin text-indigo-400"
                aria-hidden="true"
              />
              <span>{text.sidebar.loadingPage}</span>
            </div>
          </div>
        ) : null}
      </main>

      <OnboardingTour />
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
