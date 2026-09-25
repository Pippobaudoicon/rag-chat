import type { Ratelimit } from "@upstash/ratelimit";
import type { BillingEntitlements } from "@/lib/billing/entitlements";
import { getSlidingWindowRateLimit } from "@/lib/rag/cache";

// Plan-aware chat rate limit for POST /api/chat.

const GUEST_IP_LIMIT_MULTIPLIER = 4;

export type ChatRateLimitResult = Awaited<ReturnType<Ratelimit["limit"]>>;

/** The plan's chat limiter, or null when Redis is not configured. */
export function getChatRateLimiter(entitlements: BillingEntitlements) {
  const rateLimit = getSlidingWindowRateLimit(
    `chat:${entitlements.plan}`,
    entitlements.limits.chatRequests,
    entitlements.limits.window
  );
  if (!rateLimit) return null;

  return async (req: Request, userId: string): Promise<ChatRateLimitResult> => {
    const result = await rateLimit.limit(`chat:${entitlements.plan}:${userId}`);
    // Clearing the guest cookie mints a fresh quota, so guests are also
    // capped per IP (loose, to tolerate shared/NAT networks).
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (!result.success || entitlements.plan !== "guest" || !ip) return result;
    const ipResult = await getSlidingWindowRateLimit(
      "chat:guest-ip",
      entitlements.limits.chatRequests * GUEST_IP_LIMIT_MULTIPLIER,
      entitlements.limits.window
    )!.limit(ip);
    return ipResult.success ? result : ipResult;
  };
}

export function rateLimitedResponse(
  result: ChatRateLimitResult,
  entitlements: BillingEntitlements
): Response {
  return Response.json(
    {
      error: "Rate limit exceeded",
      plan: entitlements.plan,
      reset: result.reset,
      upgradeUrl:
        entitlements.plan === "guest" ? "/sign-up" : entitlements.isPro ? null : "/billing",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(result.reset),
        "X-Subscription-Plan": entitlements.plan,
      },
    }
  );
}
