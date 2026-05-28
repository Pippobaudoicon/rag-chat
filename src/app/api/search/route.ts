import { auth } from "@clerk/nextjs/server";
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

export const runtime = "nodejs";

const CHAT_MODEL = process.env.CHAT_MODEL ?? "deepseek/deepseek-v4-flash";

// GET /api/search?q=...&language=ita&sources=scriptures,conference&topK=10
// Semantic search only — no LLM generation
export async function GET(req: Request) {
  const { userId } = await auth();
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
  const languageRouting = await routeQueryLanguage(query, {
    indexLanguage: getIndexLanguage(),
    model: CHAT_MODEL,
  });

  const chunks = await retrieve(
    languageRouting.searchQuery,
    sources,
    languageRouting.indexLanguage,
    topK
  );

  return Response.json({
    query,
    searchQuery: languageRouting.searchQuery,
    chunks,
    language: uiLanguage,
    inputLanguage: {
      code: languageRouting.inputLanguageCode,
      name: languageRouting.inputLanguageName,
    },
    indexLanguage: languageRouting.indexLanguage,
  });
}
