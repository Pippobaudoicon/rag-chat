import { ZodError } from "zod";
import { getSessionEntitlements } from "@/lib/billing/entitlements";
import { getSlidingWindowRateLimit } from "@/lib/rag/cache";
import { getViewer, isGuestId } from "@/lib/auth/guest";
import { REALTIME_VOICE_ENABLED } from "@/lib/realtime/config";
import { runVoiceSemanticSearch } from "@/lib/realtime/voice";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!REALTIME_VOICE_ENABLED) return new Response("Not Found", { status: 404 });

  const { userId, has } = await getViewer();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (isGuestId(userId)) return new Response("Voice requires an account", { status: 403 });

  // Same per-plan bucket as /api/search, so voice cannot double the allowance.
  const entitlements = getSessionEntitlements(userId, (plan) => has({ plan }));
  const rateLimit = getSlidingWindowRateLimit(
    `search:${entitlements.plan}`,
    entitlements.limits.searchRequests,
    entitlements.limits.window
  );
  if (rateLimit) {
    const result = await rateLimit.limit(`search:${entitlements.plan}:${userId}`);
    if (!result.success) {
      return Response.json(
        {
          error: "Rate limit exceeded",
          plan: entitlements.plan,
          reset: result.reset,
          upgradeUrl: entitlements.isPro ? null : "/billing",
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
  }

  try {
    return Response.json(await runVoiceSemanticSearch(await req.json().catch(() => null)));
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Invalid input" }, { status: 400 });
    throw error;
  }
}
