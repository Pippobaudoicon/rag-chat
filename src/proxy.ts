import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  GUEST_COOKIE,
  claimGuestConversations,
  guestIdFromCookie,
} from "@/lib/auth/guest";

// Public routes — everything else requires auth
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/privacy-policy",
  "/api/cron/memory",
]);

// Signed-out visitors can chat as a guest (quota-limited, see entitlements).
const isGuestRoute = createRouteMatcher([
  "/",
  "/chat(.*)",
  "/api/chat(.*)",
  "/api/conversations(.*)",
  "/api/feedback",
  "/api/settings",
  "/api/billing/subscription",
]);

const GUEST_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();
  const guestCookie = req.cookies.get(GUEST_COOKIE)?.value;

  if (userId) {
    if (!guestCookie) return;
    // Just signed in/up from a guest session: carry the guest's chats over.
    const guestId = guestIdFromCookie(guestCookie);
    if (guestId) await claimGuestConversations(guestId, userId);
    const res = NextResponse.next();
    res.cookies.delete(GUEST_COOKIE);
    return res;
  }

  if (isPublicRoute(req)) return;
  if (!isGuestRoute(req)) {
    await auth.protect();
    return;
  }

  if (guestIdFromCookie(guestCookie)) return;
  const res = NextResponse.next();
  res.cookies.set(GUEST_COOKIE, crypto.randomUUID(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE_SECONDS,
  });
  return res;
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
