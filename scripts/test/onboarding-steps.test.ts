/**
 * Pure-logic regression tests for the first-visit onboarding tour
 * (`src/lib/onboarding/steps.ts`). No DOM/browser — the component is verified
 * manually; this guards the decisions that determine *what* the tour shows and
 * *when* it starts.
 *
 * Run: `pnpm run test:onboarding`
 */
import {
  ONBOARDING_STEPS,
  clampStep,
  coerceOnboardingStatus,
  eligibleSteps,
  nextStatusOnFinish,
  nextStatusOnSkip,
  onboardingLanguage,
  resolveStepMode,
  shouldAutoStart,
  type OnboardingStep,
} from "@/lib/onboarding/steps";

let failures = 0;
let total = 0;
const check = (label: string, ok: boolean, detail = "") => {
  total += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

const stepById = (id: OnboardingStep["id"]) =>
  ONBOARDING_STEPS.find((s) => s.id === id)!;

// ── Auto-start gating ────────────────────────────────────────────────────────
check("pending + /chat auto-starts", shouldAutoStart("pending", "/chat") === true);
check("pending + /chat/<id> auto-starts", shouldAutoStart("pending", "/chat/abc") === true);
check("completed never auto-starts", shouldAutoStart("completed", "/chat") === false);
check("skipped never auto-starts", shouldAutoStart("skipped", "/chat") === false);
check("pending off /chat does not auto-start", shouldAutoStart("pending", "/memory") === false);
check("pending on /billing does not auto-start", shouldAutoStart("pending", "/billing") === false);

// ── Replay starts from step zero and never downgrades persisted status ────────
// Replay is local: it resets the step index to 0 without writing a status, so a
// previously-terminal status is retained. We assert the step-zero contract and
// that the status helpers only ever yield terminal values.
check("replay step index is zero", clampStep(0, ONBOARDING_STEPS.length) === 0);
check("skip yields terminal 'skipped'", nextStatusOnSkip() === "skipped");
check("finish yields terminal 'completed'", nextStatusOnFinish() === "completed");
check(
  "no status helper produces 'pending'",
  nextStatusOnSkip() !== "pending" && nextStatusOnFinish() !== "pending"
);

// ── Language fallback (IT/EN/ES authored; others inherit English) ─────────────
check("italian → ita", onboardingLanguage("ita") === "ita");
check("english → eng", onboardingLanguage("eng") === "eng");
check("spanish → spa", onboardingLanguage("spa") === "spa");
check("french falls back to eng", onboardingLanguage("fra") === "eng");
check("german falls back to eng", onboardingLanguage("deu") === "eng");

// ── Missing targets: skip or fall back exactly as allowFallback configures ────
const noneVisible = () => false;
const allVisible = () => true;

check(
  "all anchors present → every step eligible",
  eligibleSteps(ONBOARDING_STEPS, allVisible).length === ONBOARDING_STEPS.length
);

const superStep = stepById("super-toggle"); // allowFallback: false
check("super absent → skip", resolveStepMode(superStep, false) === "skip");
check("super present → anchored", resolveStepMode(superStep, true) === "anchored");

const sourcesStep = stepById("sources"); // allowFallback: true
check("sources absent → fallback", resolveStepMode(sourcesStep, false) === "fallback");
check("sources present → anchored", resolveStepMode(sourcesStep, true) === "anchored");

check(
  "no anchors present → only allowFallback steps survive",
  eligibleSteps(ONBOARDING_STEPS, noneVisible).every((s) => s.allowFallback) &&
    eligibleSteps(ONBOARDING_STEPS, noneVisible).length ===
      ONBOARDING_STEPS.filter((s) => s.allowFallback).length
);

// ── Sidebar targets resolve only after drawer activation ──────────────────────
// Model the DOM: sidebar anchors are present iff the drawer is open.
const memoryStep = stepById("memory"); // inSidebar, allowFallback: true
const isPresentWithDrawer = (open: boolean) => (step: OnboardingStep) =>
  step.inSidebar ? open : true;

check(
  "sidebar step is fallback while drawer closed",
  resolveStepMode(memoryStep, isPresentWithDrawer(false)(memoryStep)) === "fallback"
);
check(
  "sidebar step anchors once drawer opens",
  resolveStepMode(memoryStep, isPresentWithDrawer(true)(memoryStep)) === "anchored"
);

// ── Step clamping / resume ────────────────────────────────────────────────────
const n = ONBOARDING_STEPS.length;
check("clamp negative → 0", clampStep(-3, n) === 0);
check("clamp overflow → last", clampStep(99, n) === n - 1);
check("clamp NaN → 0", clampStep(Number.NaN, n) === 0);
check("clamp in-range is identity", clampStep(2, n) === 2);
check("clamp with zero total → 0", clampStep(5, 0) === 0);

// ── Status coercion ───────────────────────────────────────────────────────────
check("coerce 'completed'", coerceOnboardingStatus("completed") === "completed");
check("coerce 'skipped'", coerceOnboardingStatus("skipped") === "skipped");
check("coerce garbage → pending", coerceOnboardingStatus("nonsense") === "pending");
check("coerce null → pending", coerceOnboardingStatus(null) === "pending");

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
