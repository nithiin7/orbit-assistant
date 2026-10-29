import Link from "next/link";

import { cn } from "@/lib/utils";

export function OrbitMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cn("size-6", className)}>
      <circle cx="16" cy="16" r="5" className="fill-brand" />
      <ellipse
        cx="16"
        cy="16"
        rx="13"
        ry="6.5"
        transform="rotate(-30 16 16)"
        className="stroke-foreground/70"
        strokeWidth="1.75"
      />
    </svg>
  );
}

type LogoProps = {
  className?: string;
  /** Classes for the wordmark, e.g. to fade it out in the collapsed sidebar. */
  textClassName?: string;
};

export function Logo({ className, textClassName }: LogoProps) {
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
    </Link>
  );
}
