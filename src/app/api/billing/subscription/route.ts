import { auth } from "@clerk/nextjs/server";
import { getBillingEntitlements } from "@/lib/billing/entitlements";

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const entitlements = await getBillingEntitlements(userId);
  return Response.json(entitlements);
}

