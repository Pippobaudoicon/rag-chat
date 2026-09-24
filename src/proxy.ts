import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  GUEST_COOKIE,
  claimGuestConversations,
  guestIdFromCookie,
} from "@/lib/auth/guest";

// Auth is checked where the data is (each page and route calls getViewer() or
// auth()), not here. The proxy only hands signed-out visitors of the
// guest-capable routes a guest id (quota-limited, see entitlements).
const GUEST_PATHS = [
  "/chat",
  "/api/chat",
  "/api/conversations",
  "/api/feedback",
  "/api/settings",
  "/api/billing/subscription",
];

function isGuestRoute(pathname: string) {
  return GUEST_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

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

  if (!isGuestRoute(req.nextUrl.pathname)) return;
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
