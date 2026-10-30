import Link from "next/link";

import { cn } from "@/utils/common";

/**
 * The Orbit mark: you at the center (the core), with Orbit circling you (an open ring carrying a
 * small satellite, the work it keeps in your orbit). Keep `app/icon.svg` in sync with it.
 */
export function OrbitMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cn("size-6", className)}>
      {/* A 300° orbit, open where the satellite sits. */}
      <path
        d="M26.63 13.15A11 11 0 1 1 18.85 5.37"
        className="stroke-brand/45"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="4.75" className="fill-brand" />
      <circle cx="23.78" cy="8.22" r="2.75" className="fill-foreground" />
    </svg>
  );
}

type LogoProps = {
  className?: string;
  /** Classes for the wordmark, e.g. to fade it out in the collapsed sidebar. */
  textClassName?: string;
  /** Show a short description of what Orbit is next to the wordmark. */
  tagline?: boolean;
};

export function Logo({ className, textClassName, tagline = false }: LogoProps) {
  return (
    <Link
      href="/"
      className={cn(
        "flex items-center gap-2 rounded-md text-base font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <OrbitMark className="shrink-0" />
      <span className={textClassName}>Orbit</span>
      {tagline ? (
        <span className="hidden border-l pl-2 text-sm font-normal tracking-normal text-muted-foreground sm:inline">
          Personal assistant
        </span>
      ) : null}
    </Link>
  );
}
