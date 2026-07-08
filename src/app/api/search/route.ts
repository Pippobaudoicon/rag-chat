import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { retrieve } from "@/lib/rag/retriever";
import {
  getIndexLanguage,
  routeQueryLanguage,
} from "@/lib/rag/language-routing";
import {
  badRequestFromZod,
  parseSourcesParam,
  searchParamsSchema,
} from "@/lib/api/validation";
import { getBillingEntitlements } from "@/lib/billing/entitlements";
import {
  recordBillingUsage,
  setBillingUsageSnapshot,
} from "@/lib/billing/usage";
import { getSlidingWindowRateLimit } from "@/lib/rag/cache";

export const runtime = "nodejs";

const CHAT_MODEL = process.env.CHAT_MODEL ?? "deepseek/deepseek-v4-flash";

// GET /api/search?q=...&language=ita&sources=scriptures,conference&topK=10
// Semantic search only — no LLM generation
export async function GET(req: Request) {
  const { userId, has } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(req.url);
  const parsedParams = searchParamsSchema.safeParse({
    q: searchParams.get("q") ?? "",
    language: searchParams.get("language") ?? undefined,
    sources: parseSourcesParam(searchParams.get("sources")),
    topK: searchParams.get("topK") ?? undefined,
  });
  if (!parsedParams.success) {
    return badRequestFromZod(parsedParams.error);
  }

  const { q: query, sources, language: uiLanguage, topK } = parsedParams.data;
  const entitlements = await getBillingEntitlements(userId, {
    hasPlan: (plan) => has({ plan }),
  });
  const effectiveTopK = Math.min(topK, entitlements.limits.maxTopK);
  const rateLimit = getSlidingWindowRateLimit(
    `search:${entitlements.plan}`,
    entitlements.limits.searchRequests,
    entitlements.limits.window
  );

  if (rateLimit) {
    const rateLimitResult = await rateLimit.limit(`search:${entitlements.plan}:${userId}`);
    if (!rateLimitResult.success) {
      return Response.json(
        {
          error: "Rate limit exceeded",
          plan: entitlements.plan,
          reset: rateLimitResult.reset,
          upgradeUrl: entitlements.isPro ? null : "/billing",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.max(1, Math.ceil((rateLimitResult.reset - Date.now()) / 1000))),
            "X-RateLimit-Limit": String(rateLimitResult.limit),
            "X-RateLimit-Remaining": String(rateLimitResult.remaining),
            "X-RateLimit-Reset": String(rateLimitResult.reset),
            "X-Subscription-Plan": entitlements.plan,
          },
        }
      );
    }

    after(() =>
      setBillingUsageSnapshot(userId, "search", {
        used: Math.max(0, rateLimitResult.limit - rateLimitResult.remaining),
        limit: rateLimitResult.limit,
        remaining: rateLimitResult.remaining,
        window: entitlements.limits.window,
        resetAt: rateLimitResult.reset,
      })
    );
  }

  after(() =>
    recordBillingUsage(
      userId,
      "search",
      entitlements.limits.searchRequests,
      entitlements.limits.window
    )
  );

  const languageRouting = await routeQueryLanguage(query, {
    indexLanguage: getIndexLanguage(),
    model: CHAT_MODEL,
  });

  const chunks = await retrieve(
    languageRouting.searchQuery,
    sources,
    languageRouting.indexLanguage,
    effectiveTopK,
    {
      scriptureLanguage: uiLanguage === "ita" ? "ita" : "eng",
    }
  );

  return Response.json({
    query,
    searchQuery: languageRouting.searchQuery,
    chunks,
    plan: entitlements.plan,
    requestedTopK: topK,
    effectiveTopK,
    language: uiLanguage,
    inputLanguage: {
      code: languageRouting.inputLanguageCode,
      name: languageRouting.inputLanguageName,
    },
    indexLanguage: languageRouting.indexLanguage,
  });
}
