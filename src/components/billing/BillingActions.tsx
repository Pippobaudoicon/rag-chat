"use client";

import { CheckoutButton, SubscriptionDetailsButton } from "@clerk/nextjs/experimental";
import { CreditCardIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type BillingActionsProps = {
  isPro: boolean;
  disabledReason?: "not-configured" | "billing-disabled";
  labels: {
    billingNotConfigured: string;
    billingDisabledAction: string;
    manageSubscription: string;
    upgradeToPro: string;
  };
};

const PRO_PLAN_ID = process.env.NEXT_PUBLIC_CLERK_BILLING_PRO_PLAN_ID;
const PRO_PLAN_KEY = process.env.NEXT_PUBLIC_CLERK_BILLING_PRO_PLAN_KEY ?? "pro_user";
const CHECKOUT_PLAN_ID = PRO_PLAN_ID ?? PRO_PLAN_KEY;

export function BillingActions({ isPro, disabledReason, labels }: BillingActionsProps) {
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
    <CheckoutButton planId={CHECKOUT_PLAN_ID} planPeriod="month">
      <Button>
        <ExternalLinkIcon />
        {labels.upgradeToPro}
      </Button>
    </CheckoutButton>
  );
}
