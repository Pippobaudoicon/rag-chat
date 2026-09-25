"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ALL_SOURCES, SUPER_SOURCES } from "@/lib/types";

/**
 * Search scope replaces manual per-source selection: Standard sends every
 * normally-visible source, Super sends all namespaces. The model may still
 * narrow *within* this scope (the backend ceilings its override to it).
 * Guests always get Standard. Remembered in localStorage.
 */
export function useSearchScope(isGuest: boolean) {
  const [searchScope, setSearchScope] = useState<"standard" | "super">("standard");
  const isSuperScope = searchScope === "super" && !isGuest;
  const sources = useMemo(
    () => (isSuperScope ? SUPER_SOURCES : ALL_SOURCES),
    [isSuperScope]
  );

  // Hydrate the search scope from localStorage after mount to avoid SSR mismatch.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("chat:search-scope");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from localStorage after mount
      if (stored === "super" || stored === "standard") setSearchScope(stored);
    } catch {
      // ignore
    }
  }, []);

  // Persist the search scope (language is persisted by LanguageProvider).
  useEffect(() => {
    localStorage.setItem("chat:search-scope", searchScope);
  }, [searchScope]);

  const toggleSearchScope = useCallback(() => {
    setSearchScope((current) => (current === "super" ? "standard" : "super"));
  }, []);

  return { isSuperScope, sources, toggleSearchScope };
}
