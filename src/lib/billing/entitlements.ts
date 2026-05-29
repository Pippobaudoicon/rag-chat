import { clerkClient } from "@clerk/nextjs/server";

export type SubscriptionPlan = "free" | "pro";

export type BillingEntitlements = {
  plan: SubscriptionPlan;
  isPro: boolean;
  billingConfigured: boolean;
  billingStatus: "enabled" | "disabled" | "unavailable";
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

type BillingEntitlementOptions = {
  hasPlan?: (plan: string) => boolean;
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

export function getConfiguredProPlanIds(): string[] {
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

export function getConfiguredProPlanSlugs(): string[] {
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

function getConfiguredProPlanKeys(): string[] {
  return [...new Set([...getConfiguredProPlanIds(), ...getConfiguredProPlanSlugs()])];
}

function freeEntitlements({
  billingStatus = "enabled",
  subscription = {},
}: {
  billingStatus?: BillingEntitlements["billingStatus"];
  subscription?: Partial<BillingEntitlements["subscription"]>;
} = {}): BillingEntitlements {
  return {
    plan: "free",
    isPro: false,
    billingConfigured: getConfiguredProPlanIds().length > 0,
    billingStatus,
    subscription: {
      id: null,
      status: null,
      activePlanId: null,
      activePlanSlug: null,
      currentPeriodEnd: null,
      ...subscription,
    },
    limits: getLimits("free"),
  };
}

function isBillingNotEnabledError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { status, errors } = error as {
    status?: unknown;
    errors?: Array<{ code?: unknown }>;
  };
  return (
    status === 403 &&
    Array.isArray(errors) &&
    errors.some((entry) => entry?.code === "billing_not_enabled")
  );
}

export async function getBillingEntitlements(
  userId: string,
  options: BillingEntitlementOptions = {}
): Promise<BillingEntitlements> {
  const cached = entitlementCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const proPlanIds = getConfiguredProPlanIds();
  const proPlanSlugs = getConfiguredProPlanSlugs();
  const hasProPlan = getConfiguredProPlanKeys().some((plan) => options.hasPlan?.(plan));

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
    const plan: SubscriptionPlan = (subscriptionActive && proItem) || hasProPlan ? "pro" : "free";
    const activeItem = proItem ?? activeItems[0] ?? null;

    const value: BillingEntitlements = {
      plan,
      isPro: plan === "pro",
      billingConfigured: true,
      billingStatus: "enabled",
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
    if (!isBillingNotEnabledError(error)) {
      console.error("Failed to load Clerk billing subscription", error);
    }

    const plan: SubscriptionPlan = hasProPlan ? "pro" : "free";
    const value: BillingEntitlements =
      plan === "pro"
        ? {
            plan: "pro",
            isPro: true,
            billingConfigured: true,
            billingStatus: isBillingNotEnabledError(error) ? "disabled" : "unavailable",
            subscription: {
              id: null,
              status: "active",
              activePlanId: null,
              activePlanSlug: "pro_user",
              currentPeriodEnd: null,
            },
            limits: getLimits("pro"),
          }
        : freeEntitlements({
            billingStatus: isBillingNotEnabledError(error) ? "disabled" : "unavailable",
          });
    entitlementCache.set(userId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }
}

export function clearBillingEntitlementsCache(userId: string): void {
  entitlementCache.delete(userId);
}
