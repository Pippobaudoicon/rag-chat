import { Redis } from "@upstash/redis";
import { createHash } from "crypto";
import type { SourceChunk } from "@/lib/types";

// Distributed cache via Upstash Redis — survives cold starts and works
// across all Vercel serverless instances (unlike the Python in-memory dict).

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
}

const CACHE_TTL_SECONDS = 3600; // 1 hour
const CACHE_PREFIX = "rag:v1:";

interface CacheEntry {
  chunks: SourceChunk[];
  answer: string;
}

// Matches Python: SHA256(f"{query}|{lang}|{','.join(sources)}|{top_k}")
export function cacheKey(
  query: string,
  lang: string,
  sources: string[],
  topK: number
): string {
  const raw = `${query}|${lang}|${[...sources].sort().join(",")}|${topK}`;
  return CACHE_PREFIX + createHash("sha256").update(raw).digest("hex");
}

export async function getFromCache(
  key: string
): Promise<CacheEntry | undefined> {
  try {
    const val = await getRedis().get<CacheEntry>(key);
    return val ?? undefined;
  } catch {
    // Cache miss on error — degrade gracefully, don't break the request
    return undefined;
  }
}

export async function setInCache(key: string, value: CacheEntry): Promise<void> {
  try {
    await getRedis().set(key, value, { ex: CACHE_TTL_SECONDS });
  } catch {
    // Best-effort — cache failure should never break a response
  }
}
