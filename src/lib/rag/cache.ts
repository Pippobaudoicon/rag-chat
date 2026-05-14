import { createHash } from "crypto";
import { Ratelimit } from "@upstash/ratelimit";
import type { Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { FinishReason } from "ai";
import type { SourceChunk, SourceType } from "@/lib/types";

// Distributed cache via Upstash Redis — survives cold starts and works
// across all Vercel serverless instances.

const CACHE_TTL_SECONDS = 3600; // 1 hour
const ANSWER_CACHE_TTL_SECONDS = 6 * 3600; // 6 hours
const TITLE_CACHE_TTL_SECONDS = 24 * 3600; // 24 hours

const RETRIEVAL_CACHE_PREFIX = "rag:v2:retrieval:";
const TOOL_RESULT_CACHE_PREFIX = "rag:v1:tool-result:";
const ANSWER_CACHE_PREFIX = "rag:v2:answer:";
const CONVERSATION_TITLE_PREFIX = "rag:v2:conversation-title:";
const CONVERSATION_LIST_PREFIX = "rag:v2:conversation-list:";

type RetrievalCacheEntry = {
  chunks: SourceChunk[];
  answer: string;
};

export type ConversationListItem = {
  id: string;
  title: string | null;
  language?: string;
  sources?: SourceType[];
  updatedAt: Date | string;
};

export type ConversationListCacheEntry = {
  items: ConversationListItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type SessionAnswerCacheEntry = {
  text: string;
  sources: SourceChunk[];
  details?: {
    model?: string;
    finishReason?: FinishReason;
    toolNames?: string[];
  };
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

function hasRedisConfig() {
  return !!process.env.UPSTASH_KV_REST_API_URL && !!process.env.UPSTASH_KV_REST_API_TOKEN;
}

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_KV_REST_API_URL;
    const token = process.env.UPSTASH_KV_REST_API_TOKEN;
    
    if (!url || !token) {
      throw new Error("Redis configuration missing: UPSTASH_KV_REST_API_URL or UPSTASH_KV_REST_API_TOKEN not set");
    }
    
    _redis = new Redis({
      url,
      token,
    });
  }
  return _redis;
}

export function getChatRateLimit(): Ratelimit | null {
  if (!hasRedisConfig()) return null;
  if (!_chatRateLimit) {
    const limit = getPositiveInt(process.env.CHAT_RATE_LIMIT_MAX_REQUESTS, 30);
    const windowValue = (process.env.CHAT_RATE_LIMIT_WINDOW ?? "1 h") as Duration;

    _chatRateLimit = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(limit, windowValue),
      analytics: true,
      prefix: "rag:ratelimit:chat",
    });
  }
  return _chatRateLimit;
}

function getPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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
  topK: number
): string {
  return (
    RETRIEVAL_CACHE_PREFIX +
    hash([query, lang, [...sources].sort().join(","), topK])
  );
}

export function questionHash(question: string): string {
  return hash([normalizeQuestion(question)]);
}

export function sessionAnswerCacheKey(
  userId: string,
  conversationId: string,
  question: string,
  options: {
    language: string;
    sources: string[];
    topK: number;
    historySignature: string;
    memorySignature: string;
  }
): string {
  const { language, sources, topK, historySignature, memorySignature } = options;
  return (
    ANSWER_CACHE_PREFIX +
    hash([
      userId,
      conversationId,
      questionHash(question),
      language,
      [...sources].sort().join(","),
      topK,
      historySignature,
      memorySignature,
    ])
  );
}

export function conversationTitleCacheKey(userId: string, conversationId: string): string {
  return `${CONVERSATION_TITLE_PREFIX}${hash([userId])}:${conversationId}`;
}

export function conversationListCacheKey(
  userId: string,
  limit: number,
  cursor: string | null
): string {
  return `${conversationListCachePrefix(userId)}${hash([limit, cursor])}`;
}

export function toolResultCacheKey(
  toolName: string,
  language: string,
  params: Record<string, unknown>
): string {
  return TOOL_RESULT_CACHE_PREFIX + hash([toolName, language, stableSerialize(params)]);
}

function conversationListCachePrefix(userId: string): string {
  return `${CONVERSATION_LIST_PREFIX}${hash([userId])}:`;
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

export async function getSessionAnswerFromCache(
  key: string
): Promise<SessionAnswerCacheEntry | undefined> {
  return safeGet<SessionAnswerCacheEntry>(key);
}

export async function setSessionAnswerInCache(
  key: string,
  value: SessionAnswerCacheEntry
): Promise<void> {
  await safeSet(key, value, ANSWER_CACHE_TTL_SECONDS);
}

export async function getConversationTitleFromCache(
  key: string
): Promise<string | null | undefined> {
  return safeGet<string | null>(key);
}

export async function setConversationTitleInCache(
  key: string,
  value: string | null
): Promise<void> {
  await safeSet(key, value, TITLE_CACHE_TTL_SECONDS);
}

export async function getConversationListFromCache(
  key: string
): Promise<ConversationListCacheEntry | undefined> {
  return safeGet<ConversationListCacheEntry>(key);
}

export async function setConversationListInCache(
  key: string,
  value: ConversationListCacheEntry
): Promise<void> {
  await safeSet(key, value, CACHE_TTL_SECONDS);
}

export async function invalidateConversationCaches(userId: string): Promise<void> {
  await safeDeleteByPrefix(conversationListCachePrefix(userId));
}

export async function invalidateConversationTitleCache(
  userId: string,
  conversationId: string
): Promise<void> {
  await safeDelete(conversationTitleCacheKey(userId, conversationId));
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

async function safeDelete(key: string): Promise<void> {
  if (!hasRedisConfig()) return;
  try {
    await getRedis().del(key);
  } catch {
    // Best-effort
  }
}

async function safeDeleteByPrefix(prefix: string): Promise<void> {
  if (!hasRedisConfig()) return;
  try {
    let cursor = 0;
    do {
      const [nextCursor, keys] = await getRedis().scan(cursor, {
        match: `${prefix}*`,
        count: 100,
      });
      cursor = Number(nextCursor);
      if (Array.isArray(keys) && keys.length > 0) {
        await getRedis().del(...keys);
      }
    } while (cursor !== 0);
  } catch {
    // Best-effort
  }
}
