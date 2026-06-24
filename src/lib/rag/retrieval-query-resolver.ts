// Request-scoped lazy retrieval-query resolver.
//
// Translation to an English-corpus query is no longer done once, globally, in
// the chat preamble. Instead each English-corpus tool resolves its own query
// lazily through this helper — so a no-tool turn pays nothing, and a scripture
// lookup never translates. `routeQueryLanguage()` stays the single authoritative
// translation implementation (local same-language fast path + dedicated routing
// model + one-shot fallback + fail-open); this only adds per-request memoization
// so repeated identical tool calls don't repeat the translation.

import type { CorpusLanguage } from "@/lib/types";
import { routeQueryLanguage, type QueryLanguageRouting } from "./language-routing";

export interface RetrievalQueryResolver {
  /** Resolve `query` to the English-corpus `target` language, memoized per request. */
  resolve(query: string, target: CorpusLanguage): Promise<QueryLanguageRouting>;
}

type RouteFn = typeof routeQueryLanguage;

/**
 * Create a resolver scoped to a single request. Memoizes by normalized
 * `(query, target)` so multiple tool calls with the same input share one
 * translation (and concurrent calls share the in-flight promise). `router` is
 * injectable for tests; production uses `routeQueryLanguage`.
 */
export function createRetrievalQueryResolver(
  options: { router?: RouteFn } = {}
): RetrievalQueryResolver {
  const router = options.router ?? routeQueryLanguage;
  const cache = new Map<string, Promise<QueryLanguageRouting>>();

  return {
    resolve(query, target) {
      const key = `${target}::${query.trim().toLowerCase()}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const pending = router(query, { indexLanguage: target });
      cache.set(key, pending);
      return pending;
    },
  };
}

/** Aggregated tool-local routing telemetry across one or more resolutions —
 *  e.g. a conference search that routes BOTH its query and its title. */
export interface ToolRoutingTelemetry {
  /** Total translation time across all resolutions (ms). */
  routingMs: number;
  /** True if any resolution translated. */
  translated: boolean;
  /** Input language code (first confident code across resolutions, else "und"). */
  inputLanguageCode?: string;
  /** Distinct routing model(s) that performed a translation, comma-joined. */
  routingModel?: string;
  /** True if any resolution used the one-shot fallback model. */
  routingFallbackUsed: boolean;
  /** Number of resolutions that invoked a routing model (0 = all local fast-path). */
  routingCalls: number;
}

/**
 * Fold one or more {@link QueryLanguageRouting} results into a single telemetry
 * record: sum durations, OR the translated/fallback flags, count the model
 * invocations, and record the distinct model(s) actually used — so a tool that
 * routes more than one field reports the whole cost, not just the first call.
 */
export function aggregateRoutingTelemetry(
  routings: QueryLanguageRouting[]
): ToolRoutingTelemetry {
  const models = [
    ...new Set(routings.map((r) => r.routingModel).filter((m): m is string => !!m)),
  ];
  const firstConfident = routings.find(
    (r) => r.inputLanguageCode && r.inputLanguageCode !== "und"
  );
  return {
    routingMs: routings.reduce((sum, r) => sum + r.routingMs, 0),
    translated: routings.some((r) => r.translated),
    inputLanguageCode: firstConfident?.inputLanguageCode ?? routings[0]?.inputLanguageCode,
    routingModel: models.length > 0 ? models.join(", ") : undefined,
    routingFallbackUsed: routings.some((r) => r.routingFallbackUsed),
    // A local same-language fast path returns routingMs 0 and no model; a model
    // call (success or fail-open) spends measurable time. Count the latter.
    routingCalls: routings.filter((r) => r.routingMs > 0).length,
  };
}
