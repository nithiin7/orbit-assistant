"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useId } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/utils/common";

/** A titled card in a finance view, with an optional link or button in its header. */
export function Panel({
  title,
  description,
  action,
  flush = false,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** A link or button at the header's end, such as "All accounts →". */
  action?: ReactNode;
  /** Let the content run to the card's edges, as lists do. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    // `min-w-0` lets the card shrink inside grids, so long text truncates instead of overflowing.
    <section aria-labelledby={id} className={cn("min-w-0", className)}>
      <Card className="h-full shadow-elevation-1">
        <div className="flex items-start justify-between gap-3 p-5 pb-4">
          <div className="min-w-0 space-y-1">
            <h3 id={id} className="text-sm font-semibold">
              {title}
            </h3>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {action ? <div className="-mt-1.5 -mr-2 shrink-0">{action}</div> : null}
        </div>
        <div className={flush ? undefined : "px-5 pb-5"}>{children}</div>
      </Card>
    </section>
  );
}

/** A failed load, said plainly, with a retry. */
export function LoadError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm",
        className,
      )}
    >
      <p>{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** Archived, finished, or closed items, folded away below a view but a click from returning. */
export function EndedSection({
  summary,
  children,
}: {
  /** Such as "2 archived or finished". */
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-xl border bg-card/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden="true"
          className="size-4 -rotate-90 transition-transform duration-150 group-open:rotate-0"
        />
        {summary}
      </summary>
      <div className="border-t">{children}</div>
    </details>
  );
}
