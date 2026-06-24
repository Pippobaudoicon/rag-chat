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
