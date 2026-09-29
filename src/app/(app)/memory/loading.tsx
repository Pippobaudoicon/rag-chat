import { Skeleton } from "@/components/ui/skeleton";

// Mirrors MemoryPageClient: header card with refresh button, then profile +
// recent conversations on the left and weekly/monthly summaries on the right.
export default function MemoryLoading() {
  return (
    <div className="h-full overflow-hidden bg-background" aria-busy="true">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6 md:px-8">
        <div className="flex flex-col gap-4 rounded-lg border border-border/60 bg-card p-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="h-8 w-40 rounded-md" />
            <Skeleton className="h-4 w-72 max-w-full rounded" />
          </div>
          <Skeleton className="h-9 w-32 shrink-0 rounded-md" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-4">
            <Skeleton className="h-64 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
          <Skeleton className="h-80 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
