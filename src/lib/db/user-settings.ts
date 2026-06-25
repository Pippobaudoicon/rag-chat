import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import {
  coerceResponseStyle,
  DEFAULT_RESPONSE_STYLE,
  type ResponseStyleId,
} from "@/lib/rag/system-prompt";
import {
  coerceOnboardingStatus,
  type OnboardingStatus,
} from "@/lib/onboarding/steps";

export interface UserPreferences {
  defaultResponseStyle: ResponseStyleId;
  onboardingStatus: OnboardingStatus;
  onboardingStep: number;
}

/**
 * Read a user's persistent preferences. Returns system defaults when the user
 * has no settings row yet (no row is created on read). Stored values are
 * coerced so a stale/invalid style or status can never reach the model/UI.
 */
export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  const db = getDb();
  const row = await db.query.userSettings.findFirst({
    where: eq(userSettings.clerkUserId, userId),
  });
  return {
    defaultResponseStyle: row
      ? coerceResponseStyle(row.defaultResponseStyle)
      : DEFAULT_RESPONSE_STYLE,
    onboardingStatus: row ? coerceOnboardingStatus(row.onboardingStatus) : "pending",
    onboardingStep: row ? Math.max(0, row.onboardingStep) : 0,
  };
}

/**
 * Set a user's default response style, creating the settings row if needed.
 */
export async function setDefaultResponseStyle(
  userId: string,
  style: ResponseStyleId
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(userSettings)
    .values({ clerkUserId: userId, defaultResponseStyle: style })
    .onConflictDoUpdate({
      target: userSettings.clerkUserId,
      set: { defaultResponseStyle: style, updatedAt: now },
    });
}

/**
 * Upsert the onboarding tour state, writing only the provided fields. Status is
 * only ever moved to a terminal value by the caller; this never resets it to
 * 'pending'.
 */
export async function setOnboardingState(
  userId: string,
  state: { status?: OnboardingStatus; step?: number }
): Promise<void> {
  const db = getDb();
  const now = new Date();
  const update: { onboardingStatus?: OnboardingStatus; onboardingStep?: number; updatedAt: Date } = {
    updatedAt: now,
  };
  if (state.status !== undefined) update.onboardingStatus = state.status;
  if (state.step !== undefined) update.onboardingStep = Math.max(0, Math.floor(state.step));

  await db
    .insert(userSettings)
    .values({
      clerkUserId: userId,
      onboardingStatus: state.status ?? "pending",
      onboardingStep: update.onboardingStep ?? 0,
    })
    .onConflictDoUpdate({
      target: userSettings.clerkUserId,
      set: update,
    });
}
