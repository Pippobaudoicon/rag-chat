"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

import { DEFAULT_RESPONSE_STYLE, type ResponseStyleId } from "@/lib/rag/system-prompt";

/**
 * Response style. The user's persistent default applies unless this
 * conversation has an explicit override (`conversationStyle !== null`).
 */
export function useResponseStyle(
  initialDefaultResponseStyle: ResponseStyleId,
  initialResponseStyle: ResponseStyleId | null,
  conversationIdRef: RefObject<string | undefined>
) {
  const [defaultResponseStyle, setDefaultResponseStyle] =
    useState<ResponseStyleId>(initialDefaultResponseStyle);
  const [conversationStyle, setConversationStyle] = useState<ResponseStyleId | null>(
    initialResponseStyle
  );
  const activeResponseStyle = conversationStyle ?? defaultResponseStyle;

  // Fallback: fetch the user's saved default if the server didn't provide one.
  useEffect(() => {
    if (initialDefaultResponseStyle !== DEFAULT_RESPONSE_STYLE) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = (await res.json()) as { defaultResponseStyle?: ResponseStyleId };
        if (!cancelled && data.defaultResponseStyle) {
          setDefaultResponseStyle(data.defaultResponseStyle);
        }
      } catch {
        // Settings fetch is non-critical; keep the system default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialDefaultResponseStyle]);

  const handleResponseStyleChange = useCallback((style: ResponseStyleId) => {
    setConversationStyle(style);
    const convId = conversationIdRef.current;
    if (convId) {
      // Persist the override immediately so it sticks even without sending.
      void fetch(`/api/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responseStyle: style }),
      });
    }
  }, [conversationIdRef]);

  const handleSetDefaultResponseStyle = useCallback((style: ResponseStyleId) => {
    setDefaultResponseStyle(style);
    void fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultResponseStyle: style }),
    });
  }, []);

  return {
    defaultResponseStyle,
    conversationStyle,
    activeResponseStyle,
    handleResponseStyleChange,
    handleSetDefaultResponseStyle,
  };
}
