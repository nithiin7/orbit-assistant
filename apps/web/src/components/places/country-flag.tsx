import "flag-icons/css/flag-icons.min.css";

import { cn } from "@/utils/common";

const SIZES = {
  sm: "text-[0.875rem]",
  md: "text-[1.125rem]",
  lg: "text-[1.75rem]",
  xl: "text-[2.5rem]",
} as const;

/**
 * A country's flag (4:3, from `flag-icons`). Each flag is its own SVG file, fetched only when
 * shown. Decorative: the country's name always sits beside it.
 */
export function CountryFlag({
  code,
  size = "md",
  className,
}: {
  /** ISO 3166-1 alpha-2. */
  code: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  // Only plain codes become class names.
  const flag = /^[A-Za-z]{2}$/.test(code) ? `fi-${code.toLowerCase()}` : null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "fi shrink-0 overflow-hidden rounded-[0.15em] bg-muted bg-cover shadow-[0_0_0_1px_var(--border)]",
        flag,
        SIZES[size],
        className,
      )}
    />
  );
}
