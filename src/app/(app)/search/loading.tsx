import { Skeleton } from "@/components/ui/skeleton";

// Mirrors SearchPageClient before the first search: centered title, the
// composer-style search card, then three example cards.
export default function SearchLoading() {
  return (
    <div className="h-full overflow-hidden bg-background" aria-busy="true">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-6 px-4 py-6 pb-[12vh]">
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-8 w-72 max-w-full rounded-lg sm:h-9" />
          <Skeleton className="h-4 w-96 max-w-full rounded" />
          <Skeleton className="h-4 w-64 max-w-full rounded" />
        </div>
        <Skeleton className="h-[106px] w-full rounded-3xl" />
        <div className="flex gap-2 overflow-hidden md:grid md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[62px] w-64 shrink-0 rounded-2xl md:w-auto" />
          ))}
        </div>
      </div>
    </div>
  );
}
