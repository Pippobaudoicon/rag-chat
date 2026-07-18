import { Skeleton } from "@/components/ui/skeleton";

export function PageLoadingSkeleton() {
  return (
    <div className="h-full overflow-hidden bg-background" aria-busy="true">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-6 md:px-8">
        <div className="rounded-lg border border-border/60 bg-card p-5">
          <div className="space-y-3">
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="h-8 w-52 rounded-md" />
            <Skeleton className="h-4 w-full max-w-2xl rounded" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-44 w-full rounded-lg" />
        </div>

        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
    </div>
  );
}
