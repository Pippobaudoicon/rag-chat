/**
 * Pure (DOM-free) logic for the first-visit onboarding tour. Everything that
 * decides *what* to show lives here so it can be unit-tested without a browser;
 * the component (`OnboardingTour.tsx`) handles the actual DOM/anchoring.
 *
 * Run the tests: `pnpm run test:onboarding`.
 */
import type { UiLanguage } from "@/lib/types";

export type OnboardingStatus = "pending" | "completed" | "skipped";

export type OnboardingStepId =
  | "composer"
  | "super-toggle"
  | "response-style"
  | "sources"
  | "memory"
  | "new-chat";

export interface OnboardingStep {
  id: OnboardingStepId;
  /** CSS selector for the anchor element (a `data-tour` attribute). */
  anchor: string;
  /** Anchor lives inside the sidebar, hidden behind a drawer on mobile. */
  inSidebar: boolean;
  /** When the anchor is absent, show a centered callout instead of skipping. */
  allowFallback: boolean;
}

/**
 * The tour, in order steps as the issue's design note requests. `sources`
 * has no anchor on a first visit (no answer has rendered yet) so it falls back;
 * sidebar steps are resolved only after the mobile drawer is opened.
 */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  { id: "composer", anchor: '[data-tour="composer"]', inSidebar: false, allowFallback: true },
  { id: "super-toggle", anchor: '[data-tour="super-toggle"]', inSidebar: false, allowFallback: false },
  { id: "response-style", anchor: '[data-tour="response-style"]', inSidebar: false, allowFallback: false },
  { id: "sources", anchor: '[data-tour="sources"]', inSidebar: false, allowFallback: true },
  { id: "memory", anchor: '[data-tour="memory"]', inSidebar: true, allowFallback: true },
  { id: "new-chat", anchor: '[data-tour="new-chat"]', inSidebar: true, allowFallback: true },
] as const;

export type StepMode = "anchored" | "fallback" | "skip";

/**
 * Per-step decision given whether its anchor is currently present (the caller
 * resolves presence against the live DOM, having opened the drawer first for
 * sidebar steps). Present → anchor it; absent → centered fallback if allowed,
 * otherwise skip the step entirely (never block chat).
 */
export function resolveStepMode(step: OnboardingStep, present: boolean): StepMode {
  if (present) return "anchored";
  return step.allowFallback ? "fallback" : "skip";
}

/** Steps that will actually be shown (anchored or fallback), in order. */
export function eligibleSteps(
  steps: readonly OnboardingStep[],
  isPresent: (step: OnboardingStep) => boolean
): OnboardingStep[] {
  return steps.filter((step) => resolveStepMode(step, isPresent(step)) !== "skip");
}

const CHAT_ROUTE = /^\/chat(\/|$)/;

export function isChatRoute(pathname: string): boolean {
  return CHAT_ROUTE.test(pathname);
}

/**
 * The tour auto-starts only for a `pending` user on a `/chat` route — the only
 * surface where the anchored controls exist. Terminal states never auto-start,
 * so a returning user is never re-interrupted.
 */
export function shouldAutoStart(status: OnboardingStatus, pathname: string): boolean {
  return status === "pending" && isChatRoute(pathname);
}

/** Clamp a persisted/resume step index into the valid range for `total` steps. */
export function clampStep(index: number, total: number): number {
  if (total <= 0) return 0;
  if (!Number.isFinite(index) || index < 0) return 0;
  if (index > total - 1) return total - 1;
  return Math.floor(index);
}

export function nextStatusOnSkip(): OnboardingStatus {
  return "skipped";
}

export function nextStatusOnFinish(): OnboardingStatus {
  return "completed";
}

/** Coerce an unknown stored value to a valid status (defaults to `pending`). */
export function coerceOnboardingStatus(value: unknown): OnboardingStatus {
  return value === "completed" || value === "skipped" ? value : "pending";
}

/**
 * Onboarding copy is authored in Italian, English, and Spanish; every other UI
 * language inherits English. Mirrors `uiText()`.
 * //TODO: temporarily hardcode the three languages that have onboarding copy, until we have all the copy translated into all languages. Then we can remove this function and just use the `language` directly.
 */
export function onboardingLanguage(language: UiLanguage): "ita" | "eng" | "spa" {
  if (language === "ita" || language === "spa") return language;
  return "eng";
}
