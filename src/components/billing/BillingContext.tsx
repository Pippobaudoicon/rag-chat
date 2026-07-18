"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BillingEntitlements } from "@/lib/billing/entitlements";
import type { BillingUsageSummary } from "@/lib/billing/usage";

export type BillingOverview = BillingEntitlements & { usage: BillingUsageSummary };

interface BillingContextValue {
  billingOverview: BillingOverview | null;
  refreshBillingOverview: (options?: { force?: boolean }) => Promise<void>;
}

const BillingContext = createContext<BillingContextValue | null>(null);

export function BillingProvider({ children }: { children: React.ReactNode }) {
  const [billingOverview, setBillingOverview] = useState<BillingOverview | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const refreshBillingOverview = useCallback((options: { force?: boolean } = {}) => {
    if (!options.force && inFlightRef.current) {
      return inFlightRef.current;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    abortControllerRef.current = controller;

    const request = (async () => {
      try {
        const endpoint = options.force
          ? "/api/billing/subscription?refresh=1"
          : "/api/billing/subscription";
        const response = await fetch(endpoint, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;

        const overview = (await response.json()) as BillingOverview;
        if (requestId === requestIdRef.current) {
          setBillingOverview(overview);
        }
      } catch {
        // Billing status should not interrupt the rest of the app.
      }
    })();

    inFlightRef.current = request;
    void request.then(() => {
      if (requestId === requestIdRef.current) {
        inFlightRef.current = null;
        abortControllerRef.current = null;
      }
    });

    return request;
  }, []);

  useEffect(() => {
    void refreshBillingOverview();

    return () => {
      requestIdRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      inFlightRef.current = null;
    };
  }, [refreshBillingOverview]);

  const value = useMemo(
    () => ({ billingOverview, refreshBillingOverview }),
    [billingOverview, refreshBillingOverview]
  );

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBillingOverview(): BillingContextValue {
  const context = useContext(BillingContext);
  if (!context) {
    throw new Error("useBillingOverview must be used within BillingProvider");
  }
  return context;
}
