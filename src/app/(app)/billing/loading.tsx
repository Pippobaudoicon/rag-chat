import { Skeleton } from "@/components/ui/skeleton";

// Mirrors BillingPageClient: header card with plan actions, current plan +
// two usage cards, then the free/pro plan cards.
export default function BillingLoading() {
  return (
    <div className="h-full overflow-hidden bg-background" aria-busy="true">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6 md:px-8">
        <div className="flex flex-col gap-4 rounded-lg border border-border/60 bg-card p-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="h-8 w-44 rounded-md" />
            <Skeleton className="h-4 w-72 max-w-full rounded" />
          </div>
          <Skeleton className="h-9 w-40 shrink-0 rounded-lg" />
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
          <Skeleton className="h-56 w-full rounded-lg" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-44 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
