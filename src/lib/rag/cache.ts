import { createHash } from "crypto";
import { Ratelimit } from "@upstash/ratelimit";
import type { Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { SourceChunk } from "@/lib/types";

// Distributed cache via Upstash Redis — survives cold starts and works
// across all Vercel serverless instances.

const CACHE_TTL_SECONDS = 3600; // 1 hour
const DEFAULT_RATE_LIMIT_WINDOW: Duration = "1 h";

const RETRIEVAL_CACHE_PREFIX = "rag:v2:retrieval:";
const TOOL_RESULT_CACHE_PREFIX = "rag:v1:tool-result:";

type RetrievalCacheEntry = {
  chunks: SourceChunk[];
};

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

let _redis: Redis | null = null;
let _chatRateLimit: Ratelimit | null = null;
const _rateLimits = new Map<string, Ratelimit>();

type RedisConfig = {
  url: string;
  token: string;
};

function resolveRedisConfig(): RedisConfig | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.UPSTASH_KV_REST_API_URL ??
    process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.UPSTASH_KV_REST_API_TOKEN ??
    process.env.KV_REST_API_TOKEN;

  return url && token ? { url, token } : null;
}

export function hasRedisConfig() {
  return resolveRedisConfig() !== null;
}

export function getRedis(): Redis {
  if (!_redis) {
    const config = resolveRedisConfig();
    if (!config) {
      throw new Error(
        "Redis configuration missing. Set UPSTASH_REDIS_REST_URL/TOKEN (or UPSTASH_KV_REST_API_URL/TOKEN, or KV_REST_API_URL/TOKEN)."
      );
    }

    _redis = new Redis(config);
  }
  return _redis;
}

export function getChatRateLimit(): Ratelimit | null {
  if (!hasRedisConfig()) return null;
  if (!_chatRateLimit) {
    const limit = getPositiveInt(process.env.CHAT_RATE_LIMIT_MAX_REQUESTS, 30);
    const windowValue = getRateLimitWindow(
      process.env.CHAT_RATE_LIMIT_WINDOW,
      DEFAULT_RATE_LIMIT_WINDOW
    );

    _chatRateLimit = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(limit, windowValue),
      analytics: true,
      prefix: "rag:ratelimit:chat",
    });
  }
  return _chatRateLimit;
}

export function getSlidingWindowRateLimit(
  name: string,
  limit: number,
  windowValue: string | undefined,
  fallbackWindow: Duration = DEFAULT_RATE_LIMIT_WINDOW
): Ratelimit | null {
  if (!hasRedisConfig()) return null;

  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 1;
  const normalizedWindow = getRateLimitWindow(windowValue, fallbackWindow);
  const cacheKey = `${name}:${normalizedLimit}:${normalizedWindow}`;
  const existing = _rateLimits.get(cacheKey);
  if (existing) return existing;

  const rateLimit = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(normalizedLimit, normalizedWindow),
    analytics: true,
    prefix: `rag:ratelimit:${name}`,
  });
  _rateLimits.set(cacheKey, rateLimit);
  return rateLimit;
}

function getPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getRateLimitWindow(value: string | undefined, fallback: Duration): Duration {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return fallback;

  if (!/^\d+\s?(ms|s|m|h|d)$/.test(normalized)) {
    return fallback;
  }

  return normalized as Duration;
}

function hash(parts: Array<string | number | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest("hex");
}

function normalizeQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ");
}

// Matches Python: SHA256(f"{query}|{lang}|{','.join(sources)}|{top_k}")
export function cacheKey(
  query: string,
  lang: string,
  sources: string[],
  topK: number,
  // Signature of retrieval ranking flags (rerank/multi-query/diversity) so the
  // cache varies with them; see retrievalFlagsSignature(). Defaults to "" so
  // structured callers that do not use those flags keep a stable key.
  flags: string = ""
): string {
  return (
    RETRIEVAL_CACHE_PREFIX +
    hash([query, lang, [...sources].sort().join(","), topK, flags])
  );
}

export function toolResultCacheKey(
  toolName: string,
  language: string,
  params: Record<string, unknown>
): string {
  return TOOL_RESULT_CACHE_PREFIX + hash([toolName, language, stableSerialize(params)]);
}

export function deriveConversationTitle(question: string): string {
  const normalized = normalizeQuestion(question);
  let title = normalized.slice(0, 60);

  if (normalized.length > 60) {
    const lastSpace = title.lastIndexOf(" ");
    title = (lastSpace > 20 ? title.slice(0, lastSpace) : title) + "…";
  }

  return title;
}

export async function getFromCache(
  key: string
): Promise<RetrievalCacheEntry | undefined> {
  return safeGet<RetrievalCacheEntry>(key);
}

export async function setInCache(key: string, value: RetrievalCacheEntry): Promise<void> {
  await safeSet(key, value, CACHE_TTL_SECONDS);
}

export async function getToolResultFromCache<T>(key: string): Promise<T | undefined> {
  return safeGet<T>(key);
}

export async function setToolResultInCache<T>(key: string, value: T): Promise<void> {
  await safeSet(key, value, CACHE_TTL_SECONDS);
}

async function safeGet<T>(key: string): Promise<T | undefined> {
  if (!hasRedisConfig()) return undefined;
  try {
    const val = await getRedis().get<T>(key);
    return val ?? undefined;
  } catch {
    return undefined;
  }
}

async function safeSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (!hasRedisConfig()) return;
  try {
    await getRedis().set(key, value, { ex: ttlSeconds });
  } catch {
    // Best-effort — cache failure should never break a response
  }
}
