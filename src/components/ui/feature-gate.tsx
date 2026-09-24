"use client";

import { Popover } from "@base-ui/react/popover";
import { LockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Wraps a button for a feature the viewer can't use yet (e.g. guests → sign
 * up, free → Pro). When locked, the button shows a lock and opens a card that
 * says why and links to `href`, instead of doing its normal action.
 * The wrapped button's own onClick still fires, so it must no-op when locked.
 */
export function FeatureGate({
  locked,
  title,
  message,
  action,
  href,
  children,
}: {
  locked: boolean;
  title: string;
  message: string;
  action: string;
  href: string;
  children: React.ReactElement;
}) {
  if (!locked) return children;
  return (
    <Popover.Root>
      <span className="relative flex shrink-0">
        <Popover.Trigger render={children} />
        <LockIcon
          aria-hidden="true"
          className="pointer-events-none absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-muted p-0.5 text-muted-foreground"
        />
      </span>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={8} className="isolate z-50">
          <Popover.Popup className="w-64 rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden">
            <Popover.Title className="mb-1 text-sm font-medium">{title}</Popover.Title>
            <Popover.Description className="mb-3 text-xs leading-relaxed text-muted-foreground">
              {message}
            </Popover.Description>
            <Button size="sm" className="w-full" render={<a href={href} />} nativeButton={false}>
              {action}
            </Button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
