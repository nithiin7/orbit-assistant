import type { Exercise, ExerciseCategory } from "@orbit/contracts";
import {
  Activity,
  BicepsFlexed,
  Bike,
  Dumbbell,
  Flower2,
  Footprints,
  HeartPulse,
  type LucideIcon,
  PersonStanding,
  RotateCw,
  Sailboat,
  Target,
  Waves,
  Weight,
} from "lucide-react";

import { cn } from "@/utils/common";

const ICONS = {
  activity: Activity,
  biceps: BicepsFlexed,
  bike: Bike,
  dumbbell: Dumbbell,
  flower: Flower2,
  footprints: Footprints,
  heart: HeartPulse,
  person: PersonStanding,
  rotate: RotateCw,
  rowing: Sailboat,
  target: Target,
  waves: Waves,
  weight: Weight,
} satisfies Record<string, LucideIcon>;

export type ExerciseIconName = keyof typeof ICONS;

/** Icons for well-known movements, matched against the exercise's name in order. */
const NAME_ICONS: readonly (readonly [RegExp, ExerciseIconName])[] = [
  [/\b(run|running|jog|sprint|treadmill|walk|walking|hike|stair)/i, "footprints"],
  [/\b(cycl|bike|spin)/i, "bike"],
  [/\bswim/i, "waves"],
  [/\browing\b|\brower\b|\berg\b/i, "rowing"],
  [/\b(yoga|stretch|pilates)/i, "flower"],
  [/\b(foam|roll(ing)?\b|cat.cow|mobility)/i, "rotate"],
  [/^(?!.*\bleg\b).*\bcurl/i, "biceps"],
  [/\b(plank|crunch|sit.?up|leg raise|ab\b|abs\b)/i, "target"],
  [/\b(jump|burpee|elliptical|skip)/i, "activity"],
];

const CATEGORY_ICONS: Record<ExerciseCategory, ExerciseIconName> = {
  strength: "dumbbell",
  cardio: "heart",
  bodyweight: "person",
  mobility: "rotate",
  flexibility: "flower",
  other: "activity",
};

/** A tint per category so the list scans by kind of training. */
const CATEGORY_TINTS: Record<ExerciseCategory, string> = {
  strength: "bg-event-orange/15 text-event-orange",
  cardio: "bg-event-rose/15 text-event-rose",
  bodyweight: "bg-event-violet/15 text-event-violet",
  mobility: "bg-event-teal/15 text-event-teal",
  flexibility: "bg-event-green/15 text-event-green",
  other: "bg-muted text-muted-foreground",
};

type ExerciseLike = Pick<Exercise, "name" | "category" | "equipment">;

/** The icon that best pictures an exercise: its movement, else its equipment or category. */
export function exerciseIcon(exercise: ExerciseLike): ExerciseIconName {
  const match = NAME_ICONS.find(([pattern]) => pattern.test(exercise.name));
  if (match) return match[1];
  if (
    exercise.category === "strength" &&
    (exercise.equipment === "machine" || exercise.equipment === "cable")
  )
    return "weight";
  return CATEGORY_ICONS[exercise.category];
}

/** A tinted, decorative icon chip for an exercise; the name beside it carries the meaning. */
export function ExerciseIcon({
  exercise,
  size = "md",
  className,
}: {
  exercise: ExerciseLike;
  size?: "md" | "lg";
  className?: string;
}) {
  const Icon = ICONS[exerciseIcon(exercise)];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        size === "lg" ? "size-11 rounded-xl" : "size-9",
        CATEGORY_TINTS[exercise.category],
        className,
      )}
    >
      <Icon className={size === "lg" ? "size-5" : "size-4"} />
    </span>
  );
}
