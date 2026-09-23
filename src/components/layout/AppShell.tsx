"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { LoaderCircleIcon, PanelLeftIcon, SquarePenIcon } from "lucide-react";
import Image from "next/image";
import { useUser } from "@clerk/nextjs";
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
const TOP_BAR_ICON_BUTTON =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

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
  // Desktop sidebar starts collapsed so the chat gets the full width.
  const [desktopOpen, setDesktopOpen] = useState(false);
  const { isLoaded: userLoaded, user } = useUser();
  const isSignedOut = userLoaded && !user;
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
      if (typeof open !== "boolean") return;
      if (window.innerWidth >= MOBILE_BREAKPOINT_PX) {
        setDesktopOpen(open);
        return;
      }
      setTourOwnsSidebar(open);
      setMobileOpen(open);
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
      {/* Desktop sidebar — collapsible, closed at start. The inner fixed width
          keeps content from reflowing while the outer width animates. */}
      <aside
        inert={!desktopOpen}
        className={`hidden shrink-0 overflow-hidden transition-[width] duration-200 ease-out md:block ${
          desktopOpen ? "w-64" : "w-0"
        }`}
      >
        <div className="flex h-full w-64 flex-col">
          <ChatSidebar
            subscriptionPlan={subscriptionPlan}
            onCollapse={() => setDesktopOpen(false)}
          />
        </div>
      </aside>

      {/* Main column: top bar + page content */}
      <main className="relative flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Top bar — participates in flex layout (no absolute) so it cannot
            overlap the page content or the notch. */}
        <header
          className="flex h-14 shrink-0 items-center gap-1 box-content
                     pl-[max(0.5rem,env(safe-area-inset-left))]
                     pr-[max(0.75rem,env(safe-area-inset-right))]
                     pt-[env(safe-area-inset-top)]"
        >
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label={text.app.openMenu}
            className={`${TOP_BAR_ICON_BUTTON} md:hidden`}
          >
            <PanelLeftIcon className="h-5 w-5" />
          </button>
          {!desktopOpen && (
            <button
              type="button"
              onClick={() => setDesktopOpen(true)}
              aria-label={text.app.openSidebar}
              title={text.app.openSidebar}
              className={`${TOP_BAR_ICON_BUTTON} hidden md:flex`}
            >
              <PanelLeftIcon className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={handleNewChatFromLogo}
            aria-label={text.sidebar.newChat}
            title={text.sidebar.newChat}
            className={`${TOP_BAR_ICON_BUTTON} ${desktopOpen ? "md:hidden" : ""}`}
          >
            <SquarePenIcon className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={handleNewChatFromLogo}
            className="ml-1 rounded-lg px-1.5 py-1 text-[15px] font-semibold tracking-tight text-foreground transition-colors hover:bg-accent"
          >
            {/* FUTURE LOGO (still ugly) */}
            {/* <Image src="/icons/logo-no-bg.png" alt="ChatLDS" width={24} height={24} className="shrink-0" /> */}
            ChatLDS
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <LanguageToggle />
            {/* Sign up lives in the chat guest banner; the top bar keeps only
                Log in so returning users can reach it on every viewport. */}
            {isSignedOut && (
              <a
                href="/sign-in"
                className="inline-flex h-8 items-center rounded-full border border-border px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                {text.app.logIn}
              </a>
            )}
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
