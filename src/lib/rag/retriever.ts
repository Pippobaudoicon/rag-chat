import { Pinecone } from "@pinecone-database/pinecone";
import { embedQuery } from "./embedder";
import type { SourceChunk, SourceType, Language } from "@/lib/types";

// ⚠️ CRITICAL: Index name must match Python VectorStore.INDEX_NAME = "lds-rag"
const INDEX_NAME = "lds-rag";

// Singleton Pinecone client — one per serverless instance
let _pc: Pinecone | null = null;
function getPinecone(): Pinecone {
  if (!_pc) _pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  return _pc;
}

export async function retrieve(
  query: string,
  sources: SourceType[],
  language: Language,
  topK = 20
): Promise<SourceChunk[]> {
  const [vector] = await Promise.all([embedQuery(query)]);
  const index = getPinecone().index(INDEX_NAME);

  // Query all namespaces in PARALLEL — much faster than the Python serial loop
  const results = await Promise.all(
    sources.map((source) =>
      index
        .namespace(source)
        .query({
          vector,
          topK,
          includeMetadata: true,
          // Matches Python: lang_filter = {"language": language.value}
          filter: { language: { $eq: language } },
        })
        .then((res) =>
          res.matches.map(
            (match): SourceChunk => ({
              id: match.id,
              text: (match.metadata?.text ?? "") as string,
              source,
              score: match.score ?? 0,
              language,
              book: match.metadata?.book as string | undefined,
              chapter: match.metadata?.chapter as number | undefined,
              verse: match.metadata?.verse as string | undefined,
              speaker: match.metadata?.speaker as string | undefined,
              title: match.metadata?.title as string | undefined,
              date: match.metadata?.date as string | undefined,
              section: match.metadata?.section as string | undefined,
              url: match.metadata?.url as string | undefined,
            })
          )
        )
    )
  );

  // Flatten, sort by score descending, return top topK overall
  // Matches Python: all_chunks.sort(key=lambda c: c.score, reverse=True)[:top_k]
  return results
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
