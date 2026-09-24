import { auth } from "@clerk/nextjs/server";
import { getBillingEntitlements } from "@/lib/billing/entitlements";
import { getBillingUsageSummary } from "@/lib/billing/usage";
import { BillingPageClient } from "@/components/billing/BillingPageClient";

export default async function BillingPage() {
  const { userId, has } = await auth.protect();

  const entitlements = await getBillingEntitlements(userId, {
    hasPlan: (plan) => has({ plan }),
  });
  const usage = await getBillingUsageSummary(userId, entitlements);

  return <BillingPageClient entitlements={entitlements} usage={usage} />;
}
