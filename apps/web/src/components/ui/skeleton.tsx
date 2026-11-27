import type { ComponentProps } from "react";

import { cn } from "@/utils/common";

/** Placeholder block for content that is still loading. Decorative; announce loading separately. */
function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

/**
 * A line of text that is still loading. It takes exactly one line box of the text size it sits
 * in (or the one given in `className`), so the real text replaces it without a jump. Set the
 * width in `className`; decorative, like `Skeleton`.
 */
function SkeletonText({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("flex h-lh max-w-full items-center", className)}
      {...props}
    >
      <span className="h-[0.75em] w-full animate-pulse rounded-sm bg-muted" />
    </span>
  );
}

type HeroSkeletonProps = {
  /** Show the progress ring's place beside the headline. */
  ring?: boolean;
  /** How many stat tiles sit under the headline. */
  tiles?: number;
  /** Container-query padding and other frame classes, e.g. `@3xl/list:p-6`. */
  className?: string;
  /** The headline's text size, matching the real hero (e.g. `text-xl @3xl/list:text-2xl`). */
  titleClassName?: string;
  /** Space between the eyebrow, headline, and sub-line, matching the real hero. */
  headerClassName?: string;
  /** The tile grid's columns, matching the real hero (e.g. `grid-cols-2 @2xl/list:grid-cols-4`). */
  tilesClassName?: string;
};

/**
 * Placeholder for a module's hero card (tinted card, optional ring, eyebrow, headline, sub-line,
 * and stat tiles) with the real card's padding and line heights.
 */
function HeroSkeleton({
  ring = false,
  tiles = 0,
  className,
  titleClassName = "text-xl",
  headerClassName = "space-y-1.5",
  tilesClassName = "grid-cols-2",
}: HeroSkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative space-y-5 overflow-hidden rounded-2xl border bg-linear-to-br from-brand-subtle/80 via-card to-card p-5 shadow-elevation-1",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-5">
        {ring ? <Skeleton className="size-24 shrink-0 rounded-full" /> : null}
        <div className={cn("min-w-0 flex-1", headerClassName)}>
          <SkeletonText className="w-32 text-xs" />
          <SkeletonText className={cn("w-56 font-semibold", titleClassName)} />
          <SkeletonText className="w-48 text-sm" />
        </div>
      </div>
      {tiles > 0 ? (
        <div className={cn("grid gap-3", tilesClassName)}>
          {Array.from({ length: tiles }, (_, index) => (
            <div key={index} className="min-w-0 rounded-xl border bg-card/80 p-4">
              <SkeletonText className="w-16 text-xs" />
              <SkeletonText className="mt-1 w-10 text-2xl leading-tight" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export { HeroSkeleton, Skeleton, SkeletonText };
