"use client";

import { BadgeCheckIcon, BrainIcon, CircleHelpIcon, CreditCardIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { FeatureGate } from "@/components/ui/feature-gate";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SubscriptionPlan } from "@/lib/billing/entitlements";
import { cn } from "@/lib/utils";
import { UserButton } from "@clerk/nextjs";

import { uiText } from "../i18n";

type UiText = ReturnType<typeof uiText>;

/** Account, plan badge, memory and billing. */
export function SidebarFooter({
  text,
  isGuest,
  isPending,
  subscriptionPlan,
  onReplayTutorial,
  onNavigate,
}: {
  text: UiText;
  isGuest: boolean;
  isPending: boolean;
  subscriptionPlan: SubscriptionPlan | null;
  onReplayTutorial: () => void;
  onNavigate: (path: "/memory" | "/billing") => void;
}) {
  const router = useRouter();
  const subscriptionPlanLabel =
    subscriptionPlan === "pro" ? text.billing.proPlan : text.billing.freePlan;

  return (
    <div className="pb-safe border-t border-border/40 px-3 py-3">
      <div className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1">
        {isGuest ? (
          // Sign up lives only in the chat guest banner; here, as in the top bar, just Log in.
          <a
            href="/sign-in"
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            {text.app.logIn}
          </a>
        ) : (
          <>
            <span className="shrink-0">
              <UserButton>
                <UserButton.MenuItems>
                  <UserButton.Action
                    label={text.onboarding.replayLabel}
                    labelIcon={<CircleHelpIcon className="h-4 w-4" />}
                    onClick={onReplayTutorial}
                  />
                </UserButton.MenuItems>
              </UserButton>
            </span>
            {subscriptionPlan ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`${text.billing.currentPlan}: ${subscriptionPlanLabel}`}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full transition-colors",
                        subscriptionPlan === "pro"
                          ? "text-indigo-400 hover:bg-indigo-500/20"
                          : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      {subscriptionPlan === "pro" ? (
                        <BadgeCheckIcon className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                      ) : null}
                    </button>
                  }
                />
                <TooltipContent side="top" className="text-xs">
                  {`${text.billing.currentPlan}: ${subscriptionPlanLabel}`}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Skeleton className="h-6 w-11 rounded-full" />
            )}
          </>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <span
            data-tour="memory"
            className="-m-1 flex shrink-0 rounded-xl border border-transparent p-1"
          >
            <Tooltip>
              <FeatureGate
                locked={isGuest}
                title={text.memory.button}
                message={text.sidebar.guestLocked.memory}
                action={text.chat.guestUsageAction}
                href="/sign-up"
              >
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => onNavigate("/memory")}
                    onPointerEnter={() => router.prefetch("/memory")}
                    onFocus={() => router.prefetch("/memory")}
                    disabled={isPending}
                    aria-label={text.memory.button}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    <BrainIcon className="h-4 w-4" />
                  </button>
                }
              />
              </FeatureGate>
              <TooltipContent side="top" className="text-xs">
                {text.memory.button}
              </TooltipContent>
            </Tooltip>
          </span>
          <Tooltip>
            <FeatureGate
              locked={isGuest}
              title={text.billing.title}
              message={text.sidebar.guestLocked.billing}
              action={text.chat.guestUsageAction}
              href="/sign-up"
            >
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => onNavigate("/billing")}
                  onPointerEnter={() => router.prefetch("/billing")}
                  onFocus={() => router.prefetch("/billing")}
                  disabled={isPending}
                  aria-label={text.billing.title}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  <CreditCardIcon className="h-4 w-4" />
                </button>
              }
            />
            </FeatureGate>
            <TooltipContent side="top" className="text-xs">
              {text.billing.title}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
