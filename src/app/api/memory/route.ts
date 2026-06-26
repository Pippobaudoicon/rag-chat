import { auth } from "@clerk/nextjs/server";
import { getBillingEntitlements } from "@/lib/billing/entitlements";
import {
  getUserMemorySnapshot,
  refreshUserMemory,
} from "@/lib/memory/conversation-memory";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const snapshot = await getUserMemorySnapshot(userId);

  return Response.json(snapshot, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(req: Request) {
  const { userId, has } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  // Manual refresh is a Pro feature — free users' memory still updates via the
  // cron job, they just can't trigger (and spam) it by hand.
  const entitlements = await getBillingEntitlements(userId, {
    hasPlan: (plan) => has({ plan }),
  });
  if (!entitlements.isPro) {
    return Response.json(
      { error: "Manual memory refresh is a Pro feature", plan: entitlements.plan, upgradeUrl: "/billing" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";
  const result = await refreshUserMemory(userId, {
    force,
    forcePeriods: force,
  });
  const snapshot = await getUserMemorySnapshot(userId);

  return Response.json(
    { result, snapshot },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
