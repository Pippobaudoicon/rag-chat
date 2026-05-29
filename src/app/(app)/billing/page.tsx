import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CheckIcon } from "lucide-react";
import { BillingActions } from "@/components/billing/BillingActions";
import { getBillingEntitlements } from "@/lib/billing/entitlements";

export default async function BillingPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const entitlements = await getBillingEntitlements(userId);
  const resetDate = entitlements.subscription.currentPeriodEnd
    ? new Date(entitlements.subscription.currentPeriodEnd).toLocaleDateString()
    : null;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-8 md:px-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Manage your ChatLDS plan and usage limits.
            </p>
          </div>
          <BillingActions isPro={entitlements.isPro} />
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-card p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-medium text-muted-foreground">Current plan</h2>
                <p className="mt-1 text-3xl font-semibold capitalize">{entitlements.plan}</p>
              </div>
              <span className="rounded-md border border-border/60 px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                {entitlements.subscription.status ?? "no subscription"}
              </span>
            </div>
            {resetDate && (
              <p className="mt-4 text-sm text-muted-foreground">
                Current billing period ends {resetDate}.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-border/60 bg-card p-5">
            <h2 className="text-sm font-medium text-muted-foreground">Usage limits</h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Chat requests</dt>
                <dd className="mt-1 text-xl font-semibold">
                  {entitlements.limits.chatRequests}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    / {entitlements.limits.window}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Search requests</dt>
                <dd className="mt-1 text-xl font-semibold">
                  {entitlements.limits.searchRequests}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    / {entitlements.limits.window}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Max sources</dt>
                <dd className="mt-1 text-xl font-semibold">{entitlements.limits.maxTopK}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <PlanCard
            name="Free"
            active={entitlements.plan === "free"}
            features={[
              `${entitlements.isPro ? "30" : entitlements.limits.chatRequests} chat requests per hour`,
              "Core LDS RAG chat",
              "Conversation history",
            ]}
          />
          <PlanCard
            name="Pro"
            active={entitlements.plan === "pro"}
            features={[
              "Higher chat and search limits",
              "Larger retrieval source window",
              "Priority room for future premium models",
            ]}
          />
        </section>
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
  return (
    <div className="rounded-lg border border-border/60 bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{name}</h2>
        {active && (
          <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
            Active
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

