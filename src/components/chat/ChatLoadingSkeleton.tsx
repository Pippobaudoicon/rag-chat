import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown instantly by Next.js loading.tsx while the conversation page
 * fetches messages from the DB. Mirrors the real ChatInterface layout
 * so there's no layout shift when the content arrives.
 */
export function ChatLoadingSkeleton() {
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Settings bar placeholder */}
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
        <Skeleton className="h-6 w-20 rounded-md" />
        <Skeleton className="h-6 w-24 rounded-md" />
        <Skeleton className="h-6 w-24 rounded-md" />
        <Skeleton className="h-6 w-24 rounded-md" />
      </div>

      {/* Message area */}
      <div className="flex-1 overflow-hidden px-4 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">
          {/* User message */}
          <div className="flex justify-end">
            <Skeleton className="h-10 w-56 rounded-lg" />
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
            <Skeleton className="h-10 w-40 rounded-lg" />
          </div>

          {/* Assistant reply */}
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-[88%] rounded" />
            <Skeleton className="h-4 w-[60%] rounded" />
          </div>
        </div>
      </div>

      {/* Input area placeholder */}
      <div className="border-t border-border/50 px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <Skeleton className="h-[72px] w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
