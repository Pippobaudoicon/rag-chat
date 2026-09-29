import { Skeleton } from "@/components/ui/skeleton";

// Mirrors SearchPageClient: sources bar, centered title, search card with
// example chips, then the dashed "no search yet" box.
export default function SearchLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" aria-busy="true">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/50 px-3 py-2 md:px-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-md" />
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          <div className="flex flex-col items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-xl" />
            <Skeleton className="h-9 w-56 rounded-lg sm:h-10" />
            <Skeleton className="h-4 w-80 max-w-full rounded" />
          </div>

          <Skeleton className="h-64 w-full rounded-xl" />

          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
