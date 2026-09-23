import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { conversations, messageFeedback } from "@/lib/db/schema";
import { invalidateConversationCaches } from "@/lib/rag/cache";

// Signed-out visitors get a random id in an httpOnly cookie (set by the proxy)
// and use it as their `clerkUserId`, so conversations, caches and ownership
// checks work unchanged. The guest plan's quota nudges them to sign up.
export const GUEST_COOKIE = "chatlds_guest";
const GUEST_PREFIX = "guest:";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuestId(userId: string): boolean {
  return userId.startsWith(GUEST_PREFIX);
}

export function guestIdFromCookie(value: string | undefined): string | null {
  return value && UUID_RE.test(value) ? GUEST_PREFIX + value : null;
}

// The signed-in Clerk user, else the guest from the cookie, else null.
export async function getViewer(): Promise<{
  userId: string | null;
  has: (params: { plan: string }) => boolean;
}> {
  const { userId, has } = await auth();
  if (userId) return { userId, has: (params) => has(params) };
  const guestId = guestIdFromCookie((await cookies()).get(GUEST_COOKIE)?.value);
  return { userId: guestId, has: () => false };
}

// After sign-in/up, move the guest's history onto the real account.
export async function claimGuestConversations(guestId: string, userId: string) {
  const db = getDb();
  await db.batch([
    db
      .update(conversations)
      .set({ clerkUserId: userId })
      .where(eq(conversations.clerkUserId, guestId)),
    db
      .update(messageFeedback)
      .set({ clerkUserId: userId })
      .where(eq(messageFeedback.clerkUserId, guestId)),
  ]);
  await invalidateConversationCaches(userId);
}
