import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import {
  coerceResponseStyle,
  DEFAULT_RESPONSE_STYLE,
  type ResponseStyleId,
} from "@/lib/rag/system-prompt";

export interface UserPreferences {
  defaultResponseStyle: ResponseStyleId;
}

/**
 * Read a user's persistent preferences. Returns system defaults when the user
 * has no settings row yet (no row is created on read). Stored values are
 * coerced so a stale/invalid style can never reach the model.
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
