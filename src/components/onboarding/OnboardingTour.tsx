"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { track } from "@vercel/analytics";
import { useLanguage } from "@/components/chat/language-context";
import { uiText, formatText } from "@/components/chat/i18n";
import {
  ONBOARDING_STEPS,
  clampStep,
  eligibleSteps,
  isChatRoute,
  shouldAutoStart,
  type OnboardingStatus,
  type OnboardingStep,
} from "@/lib/onboarding/steps";

const STEP_SAVE_DEBOUNCE_MS = 600;
const ANCHOR_RETRY_FRAMES = 12; // ~200ms; covers the lazy-mounted mobile drawer
const SIDEBAR_SETTLE_FRAMES = 14; // wait for the 200ms drawer slide transition
const SPOTLIGHT_PADDING = 8;
const MEMORY_SPOTLIGHT_PADDING = 14;
const DESKTOP_BREAKPOINT_PX = 768;
const REPLAY_READY_MAX_FRAMES = 180; // ~3s at 60fps for route/client hydration
const REPLAY_READY_SELECTORS = [
  '[data-tour="composer"]',
  '[data-tour="super-toggle"]',
  '[data-tour="response-style"]',
] as const;

interface SpotlightRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

function emitEvent(event: string, step?: OnboardingStep, index?: number) {
  track("onboarding", { event, step: step?.id ?? null, index: index ?? null });
}

/** First visible match for a `data-tour` selector, preferring one in viewport. */
function findVisibleAnchor(selector: string): HTMLElement | null {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
  const visible = nodes.filter(
    (el) =>
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== "hidden"
  );
  if (visible.length === 0) return null;
  const inView = visible.find((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  });
  return inView ?? visible[0];
}

function setSidebar(open: boolean) {
  window.dispatchEvent(new CustomEvent("onboarding:set-sidebar", { detail: { open } }));
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const isMobileViewport = () => window.innerWidth < DESKTOP_BREAKPOINT_PX;
const isReplayRequestedAfterNavigation = () =>
  sessionStorage.getItem("onboarding:replay-after-navigation") === "1";

function areReplayAnchorsReady(): boolean {
  return REPLAY_READY_SELECTORS.every((selector) => !!findVisibleAnchor(selector));
}

function measureSpotlight(el: HTMLElement, padding = SPOTLIGHT_PADDING): SpotlightRect {
  const rect = el.getBoundingClientRect();
  const top = Math.max(8, rect.top - padding);
  const left = Math.max(8, rect.left - padding);
  const right = Math.min(window.innerWidth - 8, rect.right + padding);
  const bottom = Math.min(window.innerHeight - 8, rect.bottom + padding);

  return {
    top,
    right,
    bottom,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

async function putSettings(body: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`settings PUT failed: ${res.status}`);
}

export function OnboardingTour() {
  const pathname = usePathname();
  const { language } = useLanguage();
  const text = uiText(language).onboarding;

  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState<OnboardingStep[]>([]);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Persisted status drives auto-start and whether we write terminal state.
  const persistedStatus = useRef<OnboardingStatus>("pending");
  const persistedStep = useRef(0);
  const visibleRef = useRef<OnboardingStep[]>([]);
  const indexRef = useRef(0);
  const showToken = useRef(0);
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const primaryBtn = useRef<HTMLButtonElement | null>(null);
  const startedAuto = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);

  indexRef.current = index;

  const cancelStepSave = useCallback(() => {
    if (stepTimer.current) {
      clearTimeout(stepTimer.current);
      stepTimer.current = null;
    }
  }, []);

  const scheduleStepSave = useCallback(
    (stepIndex: number) => {
      // Resume point only matters while still pending; never persist during a
      // replay of an already-terminal user.
      if (persistedStatus.current !== "pending") return;
      cancelStepSave();
      stepTimer.current = setTimeout(() => {
        void putSettings({ onboardingStep: stepIndex }).catch(() => {});
      }, STEP_SAVE_DEBOUNCE_MS);
    },
    [cancelStepSave]
  );

  // Resolve and display a single step: open/close the drawer for sidebar steps,
  // resolve the (visible) anchor with a short retry, else fall back to centered.
  const showStep = useCallback(
    async (stepIndex: number) => {
      const step = visibleRef.current[stepIndex];
      if (!step) return;
      const token = ++showToken.current;
      const mobileSidebarStep = step.inSidebar && isMobileViewport();

      // Desktop has a permanent sidebar, so leave it untouched. Mobile opens
      // the drawer only for the sidebar-specific steps.
      setSidebar(mobileSidebarStep);
      let el: HTMLElement | null = null;
      for (let i = 0; i < (mobileSidebarStep ? ANCHOR_RETRY_FRAMES : 2); i++) {
        await nextFrame();
        if (token !== showToken.current) return; // superseded by a newer step
        el = findVisibleAnchor(step.anchor);
        if (el) break;
      }
      if (token !== showToken.current) return;

      // The mobile drawer's target exists as soon as its opening animation
      // starts, but its bounding box keeps moving for ~200ms. Measure only
      // after that transition settles so the final sidebar steps line up.
      if (el && mobileSidebarStep) {
        for (let i = 0; i < SIDEBAR_SETTLE_FRAMES; i++) {
          await nextFrame();
          if (token !== showToken.current) return;
        }
        el = findVisibleAnchor(step.anchor);
      }

      if (el) {
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
        await nextFrame();
        if (token !== showToken.current) return;
      }
      setAnchorEl(el); // null → centered fallback (allowed for these steps)
      setSpotlight(
        el
          ? measureSpotlight(
              el,
              step.id === "memory" ? MEMORY_SPOTLIGHT_PADDING : SPOTLIGHT_PADDING
            )
          : null
      );
      setOpen(true);
      emitEvent("step_viewed", step, stepIndex);
      scheduleStepSave(stepIndex);
    },
    [scheduleStepSave]
  );

  const goTo = useCallback(
    (i: number) => {
      setIndex(i);
      void showStep(i);
    },
    [showStep]
  );

  const start = useCallback(
    (fromIndex: number, isReplay: boolean) => {
      // A step is droppable only if its anchor is genuinely absent and it has no
      // fallback. Sidebar anchors mount with the drawer, so treat them present.
      const vis = eligibleSteps(ONBOARDING_STEPS, (step) =>
        step.inSidebar && isMobileViewport()
          ? true
          : !!findVisibleAnchor(step.anchor)
      );
      if (vis.length === 0) return;
      visibleRef.current = vis;
      setVisible(vis);
      setSaveError(false);
      setRunning(true);
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      emitEvent(isReplay ? "replayed" : "started");
      goTo(clampStep(fromIndex, vis.length));
    },
    [goTo]
  );

  const finalize = useCallback(
    async (status: OnboardingStatus) => {
      cancelStepSave();
      // Genuine first run (still pending): persist terminal state and keep the
      // callout open if the write fails, so we never silently claim success.
      if (persistedStatus.current === "pending") {
        setSaving(true);
        setSaveError(false);
        try {
          await putSettings({ onboardingStatus: status, onboardingStep: indexRef.current });
          persistedStatus.current = status;
        } catch {
          setSaving(false);
          setSaveError(true);
          return;
        }
        setSaving(false);
      }
      emitEvent(status === "completed" ? "completed" : "skipped");
      showToken.current++; // cancel any in-flight showStep
      setOpen(false);
      setRunning(false);
      setSidebar(false);
      const focusTarget = anchorEl?.isConnected
        ? anchorEl
        : previousFocus.current?.isConnected
          ? previousFocus.current
          : findVisibleAnchor('[data-tour="composer"]');
      requestAnimationFrame(() => focusTarget?.focus());
    },
    [anchorEl, cancelStepSave]
  );

  const handleNext = useCallback(() => {
    if (index >= visible.length - 1) void finalize("completed");
    else goTo(index + 1);
  }, [index, visible.length, finalize, goTo]);

  const handleBack = useCallback(() => {
    if (index > 0) goTo(index - 1);
  }, [index, goTo]);

  const handleSkip = useCallback(() => void finalize("skipped"), [finalize]);

  // Load persisted prefs once.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { headers: { "Cache-Control": "no-store" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { onboardingStatus?: OnboardingStatus; onboardingStep?: number } | null) => {
        if (cancelled || !data) return;
        persistedStatus.current = data.onboardingStatus ?? "pending";
        persistedStep.current = data.onboardingStep ?? 0;
        setPrefsLoaded(true); // triggers the auto-start effect below
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-start: only a pending user, only on /chat, only once.
  useEffect(() => {
    if (!prefsLoaded || running || startedAuto.current) return;
    // A replay requested from another route owns startup. Waiting here avoids a
    // pending user's normal auto-start racing before ChatInterface has mounted.
    if (isReplayRequestedAfterNavigation()) return;
    if (shouldAutoStart(persistedStatus.current, pathname)) {
      startedAuto.current = true;
      start(persistedStep.current, false);
    }
  }, [pathname, running, start, prefsLoaded]);

  // Replay from the permanent entry — local, never downgrades persisted status.
  useEffect(() => {
    const onReplay = () => {
      showToken.current++;
      start(0, true);
    };
    window.addEventListener("onboarding:replay", onReplay);
    return () => window.removeEventListener("onboarding:replay", onReplay);
  }, [start]);

  // A replay requested from another AppShell page is resumed after the chat
  // route and its real anchors have mounted.
  useEffect(() => {
    if (!isChatRoute(pathname)) return;
    if (!isReplayRequestedAfterNavigation()) return;

    let cancelled = false;
    let frame = 0;

    const startWhenReady = () => {
      if (cancelled) return;
      frame += 1;

      if (areReplayAnchorsReady()) {
        sessionStorage.removeItem("onboarding:replay-after-navigation");
        showToken.current++;
        start(0, true);
        return;
      }

      if (frame < REPLAY_READY_MAX_FRAMES) {
        requestAnimationFrame(startWhenReady);
      } else {
        // Anchors never appeared (unexpected on /chat). Clear the flag so it
        // can't suppress auto-start for the rest of the session.
        sessionStorage.removeItem("onboarding:replay-after-navigation");
      }
    };

    requestAnimationFrame(startWhenReady);
    return () => {
      cancelled = true;
    };
  }, [pathname, start]);

  // Move focus into the callout each time it opens / advances.
  useEffect(() => {
    if (open && !saveError) primaryBtn.current?.focus();
  }, [open, index, saveError]);

  useEffect(() => {
    if (!open || !anchorEl) return;

    const update = () => {
      if (!anchorEl.isConnected) return;
      const step = visibleRef.current[indexRef.current];
      setSpotlight(
        measureSpotlight(
          anchorEl,
          step?.id === "memory" ? MEMORY_SPOTLIGHT_PADDING : SPOTLIGHT_PADDING
        )
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchorEl);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorEl, open]);

  useEffect(() => () => cancelStepSave(), [cancelStepSave]);

  if (!running || !open) return null;

  const step = visible[index];
  if (!step) return null;

  const card = (
    <TourCard
      text={text}
      title={text.steps[step.id].title}
      body={text.steps[step.id].body}
      index={index}
      total={visible.length}
      saving={saving}
      saveError={saveError}
      primaryRef={primaryBtn}
      onSkip={handleSkip}
      onBack={handleBack}
      onNext={handleNext}
    />
  );

  // Anchored callout when we have a live element; otherwise a centered fallback.
  if (anchorEl) {
    return (
      <>
        {spotlight ? <SpotlightOverlay rect={spotlight} /> : null}
        <Popover.Root open modal={false} onOpenChange={(next) => { if (!next) handleSkip(); }}>
        <Popover.Portal>
          <Popover.Positioner
            anchor={() => anchorEl}
            side={step.id === "new-chat" ? "right" : "bottom"}
            sideOffset={18}
            collisionPadding={12}
            className="z-[70]"
          >
            <Popover.Popup
              aria-label={step.id}
              className="relative motion-reduce:transition-none transition-[opacity,transform] duration-150 data-starting-style:translate-y-1 data-starting-style:opacity-0"
            >
              <Popover.Arrow className="flex h-3 w-6 text-popover data-[side=left]:rotate-90 data-[side=right]:-rotate-90 data-[side=top]:rotate-180">
                <svg viewBox="0 0 24 12" aria-hidden="true">
                  <path
                    d="M1 12 10.6 2.4a2 2 0 0 1 2.8 0L23 12Z"
                    fill="var(--popover)"
                    stroke="var(--border)"
                    strokeWidth="1"
                  />
                </svg>
              </Popover.Arrow>
              {card}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
        </Popover.Root>
      </>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[3px]"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") handleSkip();
      }}
    >
      <div className="motion-reduce:transition-none transition-opacity duration-150">{card}</div>
    </div>
  );
}

function SpotlightOverlay({ rect }: { rect: SpotlightRect }) {
  const panelClass =
    "fixed z-[60] bg-black/55 backdrop-blur-[3px] motion-reduce:transition-none transition-[top,right,bottom,left,width,height] duration-200";

  return (
    <>
      <div className={panelClass} style={{ inset: `0 0 auto 0`, height: rect.top }} />
      <div
        className={panelClass}
        style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }}
      />
      <div
        className={panelClass}
        style={{
          top: rect.top,
          left: rect.right,
          right: 0,
          height: rect.height,
        }}
      />
      <div className={panelClass} style={{ top: rect.bottom, right: 0, bottom: 0, left: 0 }} />
      <div
        className="pointer-events-none fixed z-[65] rounded-[0.8rem] ring-2 ring-primary ring-offset-2 ring-offset-background/80 shadow-[0_0_28px] shadow-primary/45 motion-reduce:transition-none transition-[top,left,width,height] duration-200"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        }}
        aria-hidden="true"
      />
    </>
  );
}

interface TourCardProps {
  text: ReturnType<typeof uiText>["onboarding"];
  title: string;
  body: string;
  index: number;
  total: number;
  saving: boolean;
  saveError: boolean;
  primaryRef: React.RefObject<HTMLButtonElement | null>;
  onSkip: () => void;
  onBack: () => void;
  onNext: () => void;
}

function TourCard({
  text,
  title,
  body,
  index,
  total,
  saving,
  saveError,
  primaryRef,
  onSkip,
  onBack,
  onNext,
}: TourCardProps) {
  const isLast = index >= total - 1;
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="onboarding-title"
      className="w-[min(20rem,90vw)] rounded-xl border border-border/60 bg-popover p-4 text-popover-foreground shadow-xl"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {formatText(text.stepCounter, { current: index + 1, total })}
        </span>
        <button
          type="button"
          onClick={onSkip}
          aria-label={text.closeAria}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <h2 id="onboarding-title" className="mb-1 text-sm font-semibold">
        {title}
      </h2>
      <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>

      {saveError && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {text.saveError}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {text.skip}
        </button>
        <div className="flex items-center gap-2">
          {index > 0 && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-md border border-border/60 px-3 py-1 text-xs font-medium transition-colors hover:bg-accent"
            >
              {text.back}
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            onClick={onNext}
            disabled={saving}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {isLast ? text.finish : text.next}
          </button>
        </div>
      </div>
    </div>
  );
}
