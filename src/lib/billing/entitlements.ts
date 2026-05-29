import { clerkClient } from "@clerk/nextjs/server";

type SubscriptionPlan = "free" | "pro";

type BillingEntitlements = {
  plan: SubscriptionPlan;
  isPro: boolean;
  billingConfigured: boolean;
  subscription: {
    id: string | null;
    status: string | null;
    activePlanId: string | null;
    activePlanSlug: string | null;
    currentPeriodEnd: number | null;
  };
  limits: {
    chatRequests: number;
    searchRequests: number;
    window: string;
    maxTopK: number;
  };
};

type CachedEntitlements = {
  value: BillingEntitlements;
  expiresAt: number;
};

const CACHE_TTL_MS = 60 * 1000;
const entitlementCache = new Map<string, CachedEntitlements>();

const ACTIVE_ITEM_STATUSES = new Set(["active", "upcoming"]);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "past_due"]);

const DEFAULT_FREE_CHAT_LIMIT = 30;
const DEFAULT_PRO_CHAT_LIMIT = 300;
const DEFAULT_FREE_SEARCH_LIMIT = 60;
const DEFAULT_PRO_SEARCH_LIMIT = 600;
const DEFAULT_RATE_LIMIT_WINDOW = "1h";
const DEFAULT_FREE_MAX_TOP_K = 10;
const DEFAULT_PRO_MAX_TOP_K = 20;

function getPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getConfiguredProPlanIds(): string[] {
  return [
    process.env.CLERK_BILLING_PRO_PLAN_ID,
    process.env.CLERK_BILLING_PRO_PLAN_KEY,
    process.env.NEXT_PUBLIC_CLERK_BILLING_PRO_PLAN_ID,
    process.env.NEXT_PUBLIC_CLERK_BILLING_PRO_PLAN_KEY,
    "pro_user",
  ]
    .flatMap((value) => value?.split(",") ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
}

function getConfiguredProPlanSlugs(): string[] {
  return [
    process.env.CLERK_BILLING_PRO_PLAN_SLUG,
    process.env.NEXT_PUBLIC_CLERK_BILLING_PRO_PLAN_SLUG,
    "pro_user",
    "pro",
  ]
    .flatMap((value) => value?.split(",") ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function getLimits(plan: SubscriptionPlan): BillingEntitlements["limits"] {
  const isPro = plan === "pro";
  return {
    chatRequests: getPositiveInt(
      isPro
        ? process.env.SUBSCRIPTION_PRO_CHAT_RATE_LIMIT
        : process.env.CHAT_RATE_LIMIT_MAX_REQUESTS,
      isPro ? DEFAULT_PRO_CHAT_LIMIT : DEFAULT_FREE_CHAT_LIMIT
    ),
    searchRequests: getPositiveInt(
      isPro
        ? process.env.SUBSCRIPTION_PRO_SEARCH_RATE_LIMIT
        : process.env.SUBSCRIPTION_FREE_SEARCH_RATE_LIMIT,
      isPro ? DEFAULT_PRO_SEARCH_LIMIT : DEFAULT_FREE_SEARCH_LIMIT
    ),
    window:
      process.env.SUBSCRIPTION_RATE_LIMIT_WINDOW ??
      process.env.CHAT_RATE_LIMIT_WINDOW ??
      DEFAULT_RATE_LIMIT_WINDOW,
    maxTopK: getPositiveInt(
      isPro ? process.env.SUBSCRIPTION_PRO_MAX_TOP_K : process.env.SUBSCRIPTION_FREE_MAX_TOP_K,
      isPro ? DEFAULT_PRO_MAX_TOP_K : DEFAULT_FREE_MAX_TOP_K
    ),
  };
}

function freeEntitlements(overrides: Partial<BillingEntitlements["subscription"]> = {}): BillingEntitlements {
  return {
    plan: "free",
    isPro: false,
    billingConfigured: getConfiguredProPlanIds().length > 0,
    subscription: {
      id: null,
      status: null,
      activePlanId: null,
      activePlanSlug: null,
      currentPeriodEnd: null,
      ...overrides,
    },
    limits: getLimits("free"),
  };
}

export async function getBillingEntitlements(userId: string): Promise<BillingEntitlements> {
  const cached = entitlementCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const proPlanIds = getConfiguredProPlanIds();
  const proPlanSlugs = getConfiguredProPlanSlugs();

  if (proPlanIds.length === 0) {
    const value = freeEntitlements();
    entitlementCache.set(userId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  try {
    const client = await clerkClient();
    const subscription = await client.billing.getUserBillingSubscription(userId);
    const activeItems = subscription.subscriptionItems.filter((item) =>
      ACTIVE_ITEM_STATUSES.has(item.status)
    );
    const proItem =
      activeItems.find((item) => item.planId && proPlanIds.includes(item.planId)) ??
      activeItems.find((item) => {
        const slug = item.plan?.slug?.toLowerCase();
        return slug ? proPlanSlugs.includes(slug) : false;
      });

    const subscriptionActive = ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status);
    const plan: SubscriptionPlan = subscriptionActive && proItem ? "pro" : "free";
    const activeItem = proItem ?? activeItems[0] ?? null;

    const value: BillingEntitlements = {
      plan,
      isPro: plan === "pro",
      billingConfigured: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        activePlanId: activeItem?.planId ?? null,
        activePlanSlug: activeItem?.plan?.slug ?? null,
        currentPeriodEnd: activeItem?.periodEnd ?? null,
      },
      limits: getLimits(plan),
    };

    entitlementCache.set(userId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    console.error("Failed to load Clerk billing subscription", error);
    const value = freeEntitlements();
    entitlementCache.set(userId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }
}

export function clearBillingEntitlementsCache(userId: string): void {
  entitlementCache.delete(userId);
}
