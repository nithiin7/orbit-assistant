import type { LucideIcon } from "lucide-react";

import { cn } from "@/utils/common";

/** Chip colours. Classes are written out in full so Tailwind sees them. */
const TONES = {
  brand: "bg-brand-subtle text-brand",
  blue: "bg-event-blue/12 text-event-blue",
  green: "bg-event-green/12 text-event-green",
  amber: "bg-event-amber/12 text-event-amber",
  violet: "bg-event-violet/12 text-event-violet",
  teal: "bg-event-teal/12 text-event-teal",
  orange: "bg-event-orange/12 text-event-orange",
  rose: "bg-event-rose/12 text-event-rose",
  slate: "bg-event-slate/12 text-event-slate",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/10 text-destructive",
} as const;

export type IconChipTone = keyof typeof TONES;

/** An icon in a small tinted square, set before a heading. Decorative: the heading names it. */
function IconChip({
  icon: Icon,
  tone = "brand",
  className,
}: {
  icon: LucideIcon;
  tone?: IconChipTone;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-xl",
        TONES[tone],
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

export { IconChip };
