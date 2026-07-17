"use client";

import { useState } from "react";
import { CheckoutButton, SubscriptionDetailsButton } from "@clerk/nextjs/experimental";
import { CreditCardIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type BillingPeriod = "month" | "annual";

type BillingActionsProps = {
  isPro: boolean;
  disabledReason?: "not-configured" | "billing-disabled";
  labels: {
    billingNotConfigured: string;
    billingDisabledAction: string;
    manageSubscription: string;
    upgradeToPro: string;
    billingPeriod: string;
    monthly: string;
    annual: string;
  };
};

const PRO_PLAN_ID = process.env.NEXT_PUBLIC_CLERK_BILLING_PRO_PLAN_ID;
const PRO_PLAN_KEY = process.env.NEXT_PUBLIC_CLERK_BILLING_PRO_PLAN_KEY ?? "pro_user";
const CHECKOUT_PLAN_ID = PRO_PLAN_ID ?? PRO_PLAN_KEY;

export function BillingActions({ isPro, disabledReason, labels }: BillingActionsProps) {
  const [period, setPeriod] = useState<BillingPeriod>("month");

  if (!CHECKOUT_PLAN_ID || disabledReason) {
    return (
      <Button variant="outline" disabled>
        <CreditCardIcon />
        {disabledReason === "billing-disabled"
          ? labels.billingNotConfigured
          : labels.billingDisabledAction}
      </Button>
    );
  }

  if (isPro) {
    return (
      <SubscriptionDetailsButton>
        <Button variant="outline">
          <CreditCardIcon />
          {labels.manageSubscription}
        </Button>
      </SubscriptionDetailsButton>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div
        className="flex rounded-lg border border-border bg-background p-0.5"
        role="group"
        aria-label={labels.billingPeriod}
      >
        {(["month", "annual"] as const).map((value) => {
          const selected = period === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                selected
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setPeriod(value)}
            >
              {value === "month" ? labels.monthly : labels.annual}
            </button>
          );
        })}
      </div>
      <CheckoutButton planId={CHECKOUT_PLAN_ID} planPeriod={period}>
        <Button>
          <ExternalLinkIcon />
          {labels.upgradeToPro}
        </Button>
      </CheckoutButton>
    </div>
  );
}
