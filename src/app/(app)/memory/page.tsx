import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { MemoryPageClient } from "@/components/memory/MemoryPageClient";
import { getBillingEntitlements } from "@/lib/billing/entitlements";
import { getUserMemorySnapshot } from "@/lib/memory/conversation-memory";

export default async function MemoryPage() {
  const { userId, has } = await auth();
  if (!userId) redirect("/sign-in");

  const [snapshot, entitlements] = await Promise.all([
    getUserMemorySnapshot(userId),
    getBillingEntitlements(userId, { hasPlan: (plan) => has({ plan }) }),
  ]);

  return <MemoryPageClient snapshot={snapshot} isPro={entitlements.isPro} />;
}
