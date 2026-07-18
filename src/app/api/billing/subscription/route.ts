import { auth } from "@clerk/nextjs/server";
import {
  getBillingEntitlements,
  getConfiguredProPlanIds,
  getConfiguredProPlanSlugs,
  clearBillingEntitlementsCache,
} from "@/lib/billing/entitlements";
import { getBillingUsageSummary } from "@/lib/billing/usage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { userId, has } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  if (new URL(request.url).searchParams.get("refresh") === "1") {
    clearBillingEntitlementsCache(userId);
  }

  const entitlements = await getBillingEntitlements(userId, {
    hasPlan: (plan) => has({ plan }),
  });
  const usage = await getBillingUsageSummary(userId, entitlements);

  return Response.json({
    ...entitlements,
    usage,
    usageAvailable: usage.chat.available || usage.search.available,
    configuredPlans: {
      ids: getConfiguredProPlanIds(),
      slugs: getConfiguredProPlanSlugs(),
    },
  });
}
