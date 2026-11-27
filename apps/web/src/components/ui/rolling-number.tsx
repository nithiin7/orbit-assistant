"use client";

import { useState } from "react";

import { cn } from "@/utils/common";

type Roll = { value: number; direction: "up" | "down" | null };

/**
 * A number that rolls to its new value when it changes, like an odometer: in from below when it
 * goes up, from above when it goes down. The first value shows as is.
 */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const [roll, setRoll] = useState<Roll>({ value, direction: null });
  if (roll.value !== value) {
    setRoll({ value, direction: value > roll.value ? "up" : "down" });
  }
  return (
    <span className={cn("inline-flex overflow-hidden tabular-nums", className)}>
      <span
        // A new key restarts the animation on every change.
        key={value}
        data-roll={roll.direction ?? undefined}
        className={cn(
          "inline-block",
          roll.direction === "up" && "motion-safe:animate-roll-up",
          roll.direction === "down" && "motion-safe:animate-roll-down",
        )}
      >
        {value}
      </span>
    </span>
  );
}
