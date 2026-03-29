import { auth } from "@clerk/nextjs/server";
import { retrieve } from "@/lib/rag/retriever";
import { DEFAULT_SOURCES } from "@/lib/types";
import type { SourceType, Language } from "@/lib/types";

export const runtime = "nodejs";

// GET /api/search?q=...&language=ita&sources=scriptures,conference&topK=10
// Semantic search only — no LLM generation
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q")?.trim();
  if (!query) return new Response("Bad Request: q param required", { status: 400 });

  const language = (searchParams.get("language") ?? "ita") as Language;
  const sourcesParam = searchParams.get("sources");
  const sources: SourceType[] = sourcesParam
    ? (sourcesParam.split(",").filter(Boolean) as SourceType[])
    : DEFAULT_SOURCES;
  const topK = Math.min(Number(searchParams.get("topK") ?? 20), 20);

  const chunks = await retrieve(query, sources, language, topK);

  return Response.json({ query, chunks, language });
}
