/**
 * Runtime feature flags for the RAG pipeline. Read from the environment so they
 * can be flipped per-deployment without a code change, and overridden directly
 * in the eval harness for A/B measurement.
 */

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "") return fallback;
  if (["1", "true", "on", "yes"].includes(v)) return true;
  if (["0", "false", "off", "no"].includes(v)) return false;
  return fallback;
}

/**
 * Graph-aware reranking (boost chunks that are central in the retrieved
 * cross-reference neighborhood).
 *
 * Default: ON. The eval harness consistently shows it improving ranking (MRR up,
 * zero cases worsened), so it is enabled by default. The flag is retained only as
 * a kill-switch: set `RAG_GRAPH_RERANK=false` to disable without a code change.
 * (The eval harness applies/skips rerank directly, so A/B measurement does not
 * depend on this env var.)
 */
export function isGraphRerankEnabled(): boolean {
  return envBool(process.env.RAG_GRAPH_RERANK, true);
}
