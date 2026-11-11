import type { ActivityKind } from "@orbit/contracts";
import {
  Armchair,
  Bike,
  Footprints,
  HeartPulse,
  type LucideIcon,
  Moon,
  Route,
  Waves,
  Zap,
} from "lucide-react";
import type { CSSProperties } from "react";

import { RING_KEYS, type RingKey, type RingProgress } from "@/lib/fitness";
import { cn } from "@/utils/common";

/** How each ring looks and reads. Classes are written out in full so Tailwind sees them. */
export const RINGS: Record<
  RingKey,
  { label: string; icon: LucideIcon; text: string; track: string; bar: string; chip: string }
> = {
  active: {
    label: "Active",
    icon: Zap,
    text: "text-event-rose",
    track: "text-event-rose/15",
    bar: "bg-event-rose",
    chip: "bg-event-rose/12 text-event-rose",
  },
  steps: {
    label: "Steps",
    icon: Footprints,
    text: "text-event-green",
    track: "text-event-green/15",
    bar: "bg-event-green",
    chip: "bg-event-green/12 text-event-green",
  },
  sleep: {
    label: "Sleep",
    icon: Moon,
    text: "text-event-blue",
    track: "text-event-blue/15",
    bar: "bg-event-blue",
    chip: "bg-event-blue/12 text-event-blue",
  },
};

/** The ring an activity kind fills, or `null` for a rest day. */
export function ringOf(kind: ActivityKind): RingKey | null {
  if (kind === "steps") return "steps";
  if (kind === "sleep") return "sleep";
  if (kind === "rest_day") return null;
  return "active";
}

export const KIND_ICONS: Record<ActivityKind, LucideIcon> = {
  steps: Footprints,
  walk: Route,
  run: Zap,
  cycle: Bike,
  swim: Waves,
  cardio: HeartPulse,
  sleep: Moon,
  rest_day: Armchair,
};

// Outermost first, in a 100-unit box; each ring is 10 wide with a 2-unit gap.
const RADII: Record<RingKey, number> = { active: 44, steps: 32, sleep: 20 };

/**
 * Three concentric progress rings, Active outside and Sleep inside. Each sweeps in from empty
 * (unless the person prefers reduced motion) and stops full once its goal is reached.
 */
export function ActivityRings({
  progress,
  label,
  className,
  thin = false,
}: {
  progress: RingProgress;
  /**
   * Read out in place of the drawing, such as "Active 60%, Steps 40%, Sleep 100%". Without one
   * the rings are decorative and hidden from assistive tech, for when nearby text says it.
   */
  label?: string;
  className?: string;
  /** Narrower strokes for small sizes, where full-width ones crowd together. */
  thin?: boolean;
}) {
  const width = thin ? 8 : 10;
  return (
    <svg
      viewBox="0 0 100 100"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={cn("shrink-0", className)}
    >
      {RING_KEYS.map((key) => {
        const share = Math.min(1, Math.max(0, progress[key]));
        const offset = 100 - share * 100;
        const style: CSSProperties & { "--ring-offset": number } = { "--ring-offset": offset };
        return (
          <g key={key} className={RINGS[key].text}>
            <circle
              cx="50"
              cy="50"
              r={RADII[key]}
              fill="none"
              strokeWidth={width}
              stroke="currentColor"
              className={RINGS[key].track}
            />
            {share > 0 ? (
              <circle
                cx="50"
                cy="50"
                r={RADII[key]}
                fill="none"
                strokeWidth={width}
                stroke="currentColor"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray="100"
                strokeDashoffset={offset}
                transform="rotate(-90 50 50)"
                style={style}
                className="motion-safe:animate-ring-fill"
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function describeRings(progress: RingProgress): string {
  return RING_KEYS.map((key) => `${RINGS[key].label} ${Math.round(progress[key] * 100)}%`).join(
    ", ",
  );
}
