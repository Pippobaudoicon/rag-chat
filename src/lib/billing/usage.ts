import { createHash, randomUUID } from "crypto";
import { getRedis } from "@/lib/rag/cache";
import type { BillingEntitlements } from "./entitlements";

export type BillingUsageKind = "chat" | "search";

export type BillingUsageSnapshot = {
  kind: BillingUsageKind;
  used: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  window: string;
  resetAt: number;
  available: boolean;
};

export type BillingUsageSummary = {
  chat: BillingUsageSnapshot;
  search: BillingUsageSnapshot;
};

type StoredUsageSnapshot = Omit<BillingUsageSnapshot, "available"> & {
  savedAt: number;
};

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;
const USAGE_SNAPSHOT_TTL_SECONDS = 24 * 60 * 60;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function usageKey(userId: string, kind: BillingUsageKind): string {
  return `rag:v1:usage:${kind}:${hash(userId)}`;
}

function snapshotKey(userId: string, kind: BillingUsageKind): string {
  return `rag:v1:usage-snapshot:${kind}:${hash(userId)}`;
}

export function getWindowMs(windowValue: string): number {
  const match = windowValue.trim().toLowerCase().match(/^(\d+)\s*(ms|s|m|h|d)$/);
  if (!match) return DEFAULT_WINDOW_MS;

  const value = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_WINDOW_MS;

  if (unit === "ms") return value;
  if (unit === "s") return value * 1000;
  if (unit === "m") return value * 60 * 1000;
  if (unit === "h") return value * 60 * 60 * 1000;
  return value * 24 * 60 * 60 * 1000;
}

function unavailableSnapshot(
  kind: BillingUsageKind,
  limit: number,
  windowValue: string
): BillingUsageSnapshot {
  return {
    kind,
    used: 0,
    limit,
    remaining: limit,
    percentUsed: 0,
    window: windowValue,
    resetAt: Date.now() + getWindowMs(windowValue),
    available: false,
  };
}

async function cleanUsageWindow(
  userId: string,
  kind: BillingUsageKind,
  windowValue: string,
  now = Date.now()
) {
  const key = usageKey(userId, kind);
  const windowMs = getWindowMs(windowValue);
  const redis = getRedis();
  await redis.zremrangebyscore(key, "-inf", now - windowMs);
  return { key, windowMs, redis };
}

export async function recordBillingUsage(
  userId: string,
  kind: BillingUsageKind,
  limit: number,
  windowValue: string
): Promise<BillingUsageSnapshot> {
  const now = Date.now();
  try {
    const { key, windowMs, redis } = await cleanUsageWindow(userId, kind, windowValue, now);
    await redis.zadd(key, { score: now, member: `${now}:${randomUUID()}` });
    await redis.expire(key, Math.ceil(windowMs / 1000) + 60);
    return getBillingUsageSnapshot(userId, kind, limit, windowValue, now);
  } catch (error) {
    console.error("Failed to record billing usage", error);
    return unavailableSnapshot(kind, limit, windowValue);
  }
}

export async function setBillingUsageSnapshot(
  userId: string,
  kind: BillingUsageKind,
  snapshot: {
    used: number;
    limit: number;
    remaining: number;
    window: string;
    resetAt: number;
  }
): Promise<void> {
  try {
    const value: StoredUsageSnapshot = {
      kind,
      used: snapshot.used,
      limit: snapshot.limit,
      remaining: Math.max(0, snapshot.remaining),
      percentUsed:
        snapshot.limit > 0
          ? Math.min(100, Math.round((snapshot.used / snapshot.limit) * 100))
          : 0,
      window: snapshot.window,
      resetAt: snapshot.resetAt,
      savedAt: Date.now(),
    };
    await getRedis().set(snapshotKey(userId, kind), value, {
      ex: USAGE_SNAPSHOT_TTL_SECONDS,
    });
  } catch (error) {
    console.error("Failed to store billing usage snapshot", error);
  }
}

async function getStoredUsageSnapshot(
  userId: string,
  kind: BillingUsageKind,
  limit: number,
  windowValue: string
): Promise<BillingUsageSnapshot | null> {
  try {
    const snapshot = await getRedis().get<StoredUsageSnapshot>(snapshotKey(userId, kind));
    if (!snapshot) return null;
    if (snapshot.limit !== limit || snapshot.window !== windowValue) return null;

    return {
      kind,
      used: snapshot.used,
      limit: snapshot.limit,
      remaining: snapshot.remaining,
      percentUsed: snapshot.percentUsed,
      window: snapshot.window,
      resetAt: snapshot.resetAt,
      available: true,
    };
  } catch {
    return null;
  }
}

export async function getBillingUsageSnapshot(
  userId: string,
  kind: BillingUsageKind,
  limit: number,
  windowValue: string,
  now = Date.now()
): Promise<BillingUsageSnapshot> {
  const stored = await getStoredUsageSnapshot(userId, kind, limit, windowValue);
  if (stored) return stored;

  try {
    const { key, windowMs, redis } = await cleanUsageWindow(userId, kind, windowValue, now);
    const [used, oldest] = await Promise.all([
      redis.zcard(key),
      redis.zrange<(string | number)[]>(key, 0, 0, { withScores: true }),
    ]);
    const oldestScore =
      Array.isArray(oldest) && typeof oldest[1] === "number" ? oldest[1] : now;
    const resetAt = used > 0 ? oldestScore + windowMs : now + windowMs;
    const remaining = Math.max(0, limit - used);

    return {
      kind,
      used,
      limit,
      remaining,
      percentUsed: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
      window: windowValue,
      resetAt,
      available: true,
    };
  } catch (error) {
    console.error("Failed to load billing usage", error);
    return unavailableSnapshot(kind, limit, windowValue);
  }
}

export async function getBillingUsageSummary(
  userId: string,
  entitlements: BillingEntitlements
): Promise<BillingUsageSummary> {
  const [chat, search] = await Promise.all([
    getBillingUsageSnapshot(
      userId,
      "chat",
      entitlements.limits.chatRequests,
      entitlements.limits.window
    ),
    getBillingUsageSnapshot(
      userId,
      "search",
      entitlements.limits.searchRequests,
      entitlements.limits.window
    ),
  ]);

  return { chat, search };
}
