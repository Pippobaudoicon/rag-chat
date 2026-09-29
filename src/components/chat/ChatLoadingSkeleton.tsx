import { Skeleton } from "@/components/ui/skeleton";

// Composer: textarea (min-h-14) + footer row of 36px buttons, rounded-3xl card.
const COMPOSER = "h-[106px] w-full rounded-3xl";

/**
 * Shown instantly by Next.js loading.tsx while the page loads. Mirrors the
 * real ChatInterface layout so there's no layout shift when content arrives:
 * `empty` = new chat (greeting, centered composer, suggestions), otherwise a
 * conversation with the composer docked at the bottom.
 */
export function ChatLoadingSkeleton({ empty = false }: { empty?: boolean }) {
  if (empty) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-6 md:justify-end md:pb-8">
          <Skeleton className="h-8 w-64 rounded-lg sm:h-9" />
        </div>
        <div className="order-3 px-4 pb-safe-compact md:order-none md:pb-0">
          <div className="mx-auto max-w-3xl">
            <Skeleton className={COMPOSER} />
          </div>
        </div>
        <div className="px-4 pb-3 md:flex-[1.15] md:pb-0 md:pt-2">
          <div className="mx-auto flex max-w-3xl gap-2 overflow-hidden md:grid md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[62px] w-64 shrink-0 rounded-2xl md:w-auto" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Message area */}
      <div className="flex-1 overflow-hidden px-4 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">
          {/* User message */}
          <div className="flex justify-end">
            <Skeleton className="h-12 w-56 rounded-lg" />
          </div>

          {/* Assistant reply — multi-line */}
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-[92%] rounded" />
            <Skeleton className="h-4 w-[85%] rounded" />
            <Skeleton className="h-4 w-[78%] rounded" />
          </div>

          {/* User message */}
          <div className="flex justify-end">
            <Skeleton className="h-12 w-40 rounded-lg" />
          </div>

          {/* Assistant reply */}
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-[88%] rounded" />
            <Skeleton className="h-4 w-[60%] rounded" />
          </div>
        </div>
      </div>

      {/* Composer docked at the bottom + disclaimer line */}
      <div className="pb-safe-compact px-4 pt-1">
        <div className="mx-auto max-w-3xl">
          <Skeleton className={COMPOSER} />
          <div className="mt-1.5 h-[17px]" />
        </div>
      </div>
    </div>
  );
}
