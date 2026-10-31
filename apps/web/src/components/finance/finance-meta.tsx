import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/utils/common";

export type ChipTone = "danger" | "warning" | "success" | "brand" | "muted" | "quiet";

const CHIP_TONES: Record<ChipTone, string> = {
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-warning/12 text-warning",
  success: "bg-success/12 text-success",
  brand: "bg-brand-subtle text-brand",
  muted: "bg-muted/70 text-foreground",
  quiet: "bg-muted/50 text-muted-foreground",
};

/**
 * A small rounded label for a status or fact about a row, in the style of the task chips. Its
 * words carry the meaning; the color only reinforces them.
 */
export function Chip({
  tone = "quiet",
  icon: Icon,
  className,
  children,
}: {
  tone?: ChipTone;
  icon?: LucideIcon | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        CHIP_TONES[tone],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3" /> : null}
      {children}
    </span>
  );
}

/** Uppercase section label with a count, as the task and reminder lists use. */
export function SectionHeading({
  id,
  tone = "default",
  count,
  trailing,
  children,
}: {
  id: string;
  tone?: "default" | "danger" | "brand";
  count?: number;
  /** A figure at the end of the line, such as the section's total. */
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1">
      <h3
        id={id}
        className={cn(
          "flex items-center gap-2 text-xs font-semibold tracking-wide uppercase",
          tone === "danger"
            ? "text-destructive"
            : tone === "brand"
              ? "text-brand"
              : "text-muted-foreground",
        )}
      >
        {children}
        {count !== undefined ? (
          <span
            aria-hidden="true"
            className="rounded-full bg-muted px-1.5 font-medium text-muted-foreground tabular-nums"
          >
            {count}
          </span>
        ) : null}
      </h3>
      {trailing ? (
        <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{trailing}</p>
      ) : null}
    </div>
  );
}

/** The card a list of rows sits in. A `rows` container, so rows can lay out by their width. */
export const rowListClassName =
  "@container/rows divide-y overflow-hidden rounded-xl border bg-card shadow-elevation-1";

const TWO_COLUMNS = {
  "5xl":
    "@5xl/list:grid-cols-2 @5xl/list:divide-y-0 @5xl/list:*:-mb-px @5xl/list:*:border-b @5xl/list:*:odd:border-r @5xl/list:*:odd:last:border-r-0",
  "6xl":
    "@6xl/list:grid-cols-2 @6xl/list:divide-y-0 @6xl/list:*:-mb-px @6xl/list:*:border-b @6xl/list:*:odd:border-r @6xl/list:*:odd:last:border-r-0",
} as const;

/**
 * Two columns of rows on wide lists, with a rule between them. A lone row keeps the full width,
 * so it doesn't sit in half of an otherwise empty card.
 */
export function twoColumnRows(count: number, from: keyof typeof TWO_COLUMNS): string {
  return count > 1 ? TWO_COLUMNS[from] : "";
}
