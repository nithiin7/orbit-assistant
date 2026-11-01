import type { HabitColor, HabitIcon as HabitIconName } from "@orbit/contracts";
import {
  Bike,
  BookOpen,
  Brain,
  Briefcase,
  Coffee,
  Droplet,
  Dumbbell,
  Footprints,
  GraduationCap,
  Heart,
  Leaf,
  type LucideIcon,
  Moon,
  Music,
  PenLine,
  Smile,
  Sparkles,
  Sun,
  Wallet,
} from "lucide-react";

import { cn } from "@/utils/common";

export const HABIT_ICON_COMPONENTS: Record<HabitIconName, LucideIcon> = {
  sparkles: Sparkles,
  book: BookOpen,
  dumbbell: Dumbbell,
  droplet: Droplet,
  brain: Brain,
  moon: Moon,
  sun: Sun,
  heart: Heart,
  leaf: Leaf,
  pen: PenLine,
  music: Music,
  coffee: Coffee,
  bike: Bike,
  footprints: Footprints,
  wallet: Wallet,
  graduation: GraduationCap,
  briefcase: Briefcase,
  smile: Smile,
};

/** Tinted tiles, text, and fills per palette color. Written out so Tailwind sees each class. */
export const COLOR_STYLES: Record<HabitColor, { tile: string; fill: string; text: string }> = {
  blue: {
    tile: "bg-event-blue/15 text-event-blue",
    fill: "bg-event-blue",
    text: "text-event-blue",
  },
  green: {
    tile: "bg-event-green/15 text-event-green",
    fill: "bg-event-green",
    text: "text-event-green",
  },
  amber: {
    tile: "bg-event-amber/20 text-event-amber",
    fill: "bg-event-amber",
    text: "text-event-amber",
  },
  rose: {
    tile: "bg-event-rose/15 text-event-rose",
    fill: "bg-event-rose",
    text: "text-event-rose",
  },
  violet: {
    tile: "bg-event-violet/15 text-event-violet",
    fill: "bg-event-violet",
    text: "text-event-violet",
  },
  teal: {
    tile: "bg-event-teal/15 text-event-teal",
    fill: "bg-event-teal",
    text: "text-event-teal",
  },
  orange: {
    tile: "bg-event-orange/15 text-event-orange",
    fill: "bg-event-orange",
    text: "text-event-orange",
  },
  slate: {
    tile: "bg-event-slate/15 text-event-slate",
    fill: "bg-event-slate",
    text: "text-event-slate",
  },
};

/** A habit's or routine's icon on a tile of its color. Decorative: the name is beside it. */
export function HabitTile({
  icon,
  color,
  className,
}: {
  icon: HabitIconName;
  color: HabitColor;
  className?: string;
}) {
  const Icon = HABIT_ICON_COMPONENTS[icon];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg",
        COLOR_STYLES[color].tile,
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

/** A thin progress bar from 0 to 1, in the habit's color. */
export function ProgressBar({
  value,
  color,
  label,
  className,
}: {
  value: number;
  color: HabitColor;
  label: string;
  className?: string;
}) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300",
          COLOR_STYLES[color].fill,
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
