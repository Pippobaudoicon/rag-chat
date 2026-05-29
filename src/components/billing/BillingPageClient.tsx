"use client";

import { CheckIcon, GaugeIcon, MessageSquareIcon, SearchIcon, SparklesIcon } from "lucide-react";
import { BillingActions } from "@/components/billing/BillingActions";
import { useLanguage } from "@/components/chat/language-context";
import { uiText } from "@/components/chat/i18n";
import type { BillingEntitlements } from "@/lib/billing/entitlements";
import type { BillingUsageSnapshot, BillingUsageSummary } from "@/lib/billing/usage";

type BillingPageClientProps = {
  entitlements: BillingEntitlements;
  usage: BillingUsageSummary;
};

function formatDate(value: number | null, locale: string): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(value));
}

function usageTone(percentUsed: number) {
  if (percentUsed >= 90) return "bg-rose-500";
  if (percentUsed >= 75) return "bg-amber-500";
  return "bg-emerald-500";
}

function UsageCard({
  usage,
  title,
  description,
  icon,
  remainingLabel,
}: {
  usage: BillingUsageSnapshot;
  title: string;
  description: string;
  icon: React.ReactNode;
  remainingLabel: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <span className="text-xs font-medium text-muted-foreground">
          {usage.used}/{usage.limit}
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-[width] ${usageTone(usage.percentUsed)}`}
          style={{ width: `${usage.percentUsed}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{usage.percentUsed}%</span>
        <span>{remainingLabel.replace("{count}", String(usage.remaining))}</span>
      </div>
    </div>
  );
}

function PlanCard({
  name,
  active,
  features,
}: {
  name: string;
  active: boolean;
  features: string[];
}) {
  const { language } = useLanguage();
  const text = uiText(language).billing;

  return (
    <div className="rounded-lg border border-border/60 bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{name}</h2>
        {active && (
          <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
            {text.active}
          </span>
        )}
      </div>
      <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2">
            <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BillingPageClient({ entitlements, usage }: BillingPageClientProps) {
  const { language } = useLanguage();
  const text = uiText(language).billing;
  const locale = language === "ita" ? "it-IT" : "en-US";
  const resetDate = formatDate(entitlements.subscription.currentPeriodEnd, locale);
  const usageAvailable = usage.chat.available || usage.search.available;
  const isCloseToLimit =
    entitlements.plan === "free" &&
    (usage.chat.percentUsed >= 75 || usage.search.percentUsed >= 75);
  const disabledReason =
    entitlements.billingStatus === "disabled" ? "billing-disabled" : undefined;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6 md:px-8">
        <header className="flex flex-col gap-4 rounded-lg border border-border/60 bg-card p-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <GaugeIcon className="h-3.5 w-3.5" />
              <span>{text.accountUsage}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{text.title}</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {text.description}
            </p>
          </div>
          <BillingActions
            isPro={entitlements.isPro}
            disabledReason={disabledReason}
            labels={text.actions}
          />
        </header>

        {entitlements.billingStatus === "disabled" && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {text.billingDisabled}
          </div>
        )}

        {isCloseToLimit && (
          <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-primary">{text.closeToLimitTitle}</p>
              <p className="text-muted-foreground">{text.closeToLimitDescription}</p>
            </div>
            <BillingActions
              isPro={false}
              disabledReason={disabledReason}
              labels={text.actions}
            />
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-[1fr_2fr]">
          <div className="rounded-lg border border-border/60 bg-card p-5">
            <h2 className="text-sm font-medium text-muted-foreground">{text.currentPlan}</h2>
            <p className="mt-2 text-4xl font-semibold capitalize">{entitlements.plan}</p>
            <p className="mt-3 text-sm text-muted-foreground">
              {resetDate ? text.periodEnds.replace("{date}", resetDate) : text.noSubscription}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md bg-background p-3">
                <p className="text-muted-foreground">{text.maxSources}</p>
                <p className="mt-1 text-xl font-semibold">{entitlements.limits.maxTopK}</p>
              </div>
              <div className="rounded-md bg-background p-3">
                <p className="text-muted-foreground">{text.window}</p>
                <p className="mt-1 text-xl font-semibold">{entitlements.limits.window}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <UsageCard
              usage={usage.chat}
              title={text.chatRequests}
              description={text.chatDescription}
              icon={<MessageSquareIcon className="h-4 w-4" />}
              remainingLabel={text.remaining}
            />
            <UsageCard
              usage={usage.search}
              title={text.searchRequests}
              description={text.searchDescription}
              icon={<SearchIcon className="h-4 w-4" />}
              remainingLabel={text.remaining}
            />
          </div>
        </section>

        {!usageAvailable && (
          <p className="rounded-lg border border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground">
            {text.usageUnavailable}
          </p>
        )}

        <section className="grid gap-4 md:grid-cols-2">
          <PlanCard
            name={text.freePlan}
            active={entitlements.plan === "free"}
            features={[
              text.freeChatLimit.replace("{count}", String(entitlements.limits.chatRequests)),
              text.coreChat,
              text.conversationHistory,
            ]}
          />
          <PlanCard
            name={text.proPlan}
            active={entitlements.plan === "pro"}
            features={[
              text.proHigherLimits,
              text.proSources,
              text.proModels,
            ]}
          />
        </section>

        {!entitlements.isPro && (
          <section className="rounded-lg border border-border/60 bg-card p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <SparklesIcon className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">{text.upgradeTitle}</h2>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    {text.upgradeDescription}
                  </p>
                </div>
              </div>
              <BillingActions
                isPro={false}
                disabledReason={disabledReason}
                labels={text.actions}
              />
            </div>
          </section>
        )}

        {entitlements.isPro && (
          <p className="w-fit rounded-lg border border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground">
            {text.proActiveNote}
          </p>
        )}
      </div>
    </div>
  );
}
