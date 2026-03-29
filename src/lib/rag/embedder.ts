// Voyage AI embedding via direct REST — no SDK needed, keeps bundle lean.
//
// ⚠️ CRITICAL: Model MUST stay "voyage-4-large" — the Pinecone index was built
// with this model at 1024 dimensions. Changing it makes all existing vectors
// incompatible and breaks retrieval silently (wrong results, no error).

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
export const VOYAGE_MODEL = "voyage-4-large"; // matches Python: Embedder.MODEL = "voyage-4-large"
export const VOYAGE_DIMENSION = 1024;

export async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [text],
      input_type: "query", // MUST be "query" for search — matches Python embed_query()
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voyage AI error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.data[0].embedding as number[];
}
