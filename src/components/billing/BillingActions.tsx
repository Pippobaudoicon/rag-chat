"use client";

import { CheckoutButton, SubscriptionDetailsButton } from "@clerk/nextjs/experimental";
import { CreditCardIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type BillingActionsProps = {
  isPro: boolean;
};

const PRO_PLAN_ID = process.env.NEXT_PUBLIC_CLERK_BILLING_PRO_PLAN_ID;
const PRO_PLAN_KEY = process.env.NEXT_PUBLIC_CLERK_BILLING_PRO_PLAN_KEY ?? "pro_user";
const CHECKOUT_PLAN_ID = PRO_PLAN_ID ?? PRO_PLAN_KEY;

export function BillingActions({ isPro }: BillingActionsProps) {
  if (!CHECKOUT_PLAN_ID) {
    return (
      <Button variant="outline" disabled>
        <CreditCardIcon />
        Billing not configured
      </Button>
    );
  }

  if (isPro) {
    return (
      <SubscriptionDetailsButton>
        <Button variant="outline">
          <CreditCardIcon />
          Manage subscription
        </Button>
      </SubscriptionDetailsButton>
    );
  }

  return (
    <CheckoutButton planId={CHECKOUT_PLAN_ID} planPeriod="month">
      <Button>
        <ExternalLinkIcon />
        Upgrade to Pro
      </Button>
    </CheckoutButton>
  );
}
