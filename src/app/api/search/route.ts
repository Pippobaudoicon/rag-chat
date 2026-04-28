import { auth } from "@clerk/nextjs/server";
import { retrieve } from "@/lib/rag/retriever";
import {
  badRequestFromZod,
  parseSourcesParam,
  searchParamsSchema,
} from "@/lib/api/validation";

export const runtime = "nodejs";

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

  const { q: query, sources, language, topK } = parsedParams.data;

  const chunks = await retrieve(query, sources, language, topK);

  return Response.json({ query, chunks, language });
}
