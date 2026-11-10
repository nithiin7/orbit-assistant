import { describe, expect, it } from "vitest";

import {
  activityGoals,
  closedRings,
  dayTotals,
  DEFAULT_ACTIVITY_GOALS,
  recentDays,
  ringProgress,
  ringsClosedBySave,
  ringStreak,
  summarizeDays,
  totalsByDay,
} from "./activity";

type Kind = "steps" | "walk" | "run" | "cycle" | "swim" | "cardio" | "sleep" | "rest_day";

let next = 0;
function entry(
  day: string,
  kind: Kind,
  value: { steps?: number; minutes?: number; m?: number } = {},
) {
  next += 1;
  return {
    id: `a${next}`,
    day,
    kind,
    steps: value.steps ?? null,
    distance_m: value.m ?? null,
    duration_s: value.minutes === undefined ? null : value.minutes * 60,
  };
}

const goals = { steps: 10_000, active_s: 30 * 60, sleep_s: 8 * 3600 };

describe("activity rings", () => {
  it("falls back to default goals for unset targets", () => {
    expect(activityGoals(null)).toEqual(DEFAULT_ACTIVITY_GOALS);
    expect(
      activityGoals({
        energy_cal: null,
        protein_mg: null,
        carbs_mg: null,
        fat_mg: null,
        fiber_mg: null,
        water_ml: null,
        steps: 6000,
        active_s: null,
      }),
    ).toEqual({ ...DEFAULT_ACTIVITY_GOALS, steps: 6000 });
  });

  it("totals each day by ring", () => {
    const days = totalsByDay([
      entry("2030-01-14", "steps", { steps: 4000 }),
      entry("2030-01-14", "steps", { steps: 7000 }),
      entry("2030-01-14", "run", { minutes: 20, m: 4000 }),
      entry("2030-01-14", "cycle", { minutes: 15 }),
      entry("2030-01-14", "sleep", { minutes: 7 * 60 }),
      entry("2030-01-13", "rest_day"),
    ]);
    const today = dayTotals(days, "2030-01-14");
    expect(today).toMatchObject({ steps: 11_000, active_s: 35 * 60, sleep_s: 7 * 3600 });
    expect(today.distance_m).toBe(4000);
    expect(dayTotals(days, "2030-01-13").rest).toBe(true);
    expect(dayTotals(days, "2030-01-01").entries).toBe(0);

    const progress = ringProgress(today, goals);
    expect(progress.steps).toBeCloseTo(1.1);
    expect(progress.sleep).toBeCloseTo(0.875);
    expect(closedRings(progress)).toEqual(["active", "steps"]);
  });

  it("counts a streak of days with a closed ring, kept alive by rest days", () => {
    const days = totalsByDay([
      entry("2030-01-10", "steps", { steps: 12_000 }),
      entry("2030-01-11", "rest_day"),
      entry("2030-01-12", "walk", { minutes: 45 }),
      entry("2030-01-13", "sleep", { minutes: 8 * 60 }),
      entry("2030-01-14", "steps", { steps: 200 }),
    ]);
    // Today has no closed ring yet, so the streak runs through yesterday.
    expect(ringStreak(days, goals, "2030-01-14")).toBe(3);
    expect(ringStreak(days, goals, "2030-01-16")).toBe(0);
    expect(ringStreak(new Map(), goals, "2030-01-14")).toBe(0);
  });

  it("summarizes a week", () => {
    const week = recentDays("2030-01-14");
    expect(week).toHaveLength(7);
    expect(week[0]).toBe("2030-01-08");
    expect(week[6]).toBe("2030-01-14");
    const days = totalsByDay([
      entry("2030-01-14", "steps", { steps: 10_000 }),
      entry("2030-01-14", "run", { minutes: 30 }),
      entry("2030-01-14", "sleep", { minutes: 8 * 60 }),
      entry("2030-01-12", "sleep", { minutes: 6 * 60 }),
      entry("2030-01-01", "steps", { steps: 99_000 }),
    ]);
    expect(summarizeDays(days, goals, week)).toEqual({
      steps: 10_000,
      active_s: 30 * 60,
      distance_m: 0,
      averageSleep_s: 7 * 3600,
      perfectDays: 1,
    });
    expect(summarizeDays(new Map(), goals, week).averageSleep_s).toBeNull();
  });

  it("finds the rings a save closes", () => {
    const steps = entry("2030-01-14", "steps", { steps: 9000 });
    const list = [steps, entry("2030-01-14", "run", { minutes: 30 })];
    expect(ringsClosedBySave(list, entry("2030-01-14", "steps", { steps: 1500 }), goals)).toEqual({
      closed: ["steps"],
      allClosed: false,
    });
    // Correcting an entry replaces it rather than adding to it.
    expect(ringsClosedBySave(list, { ...steps, steps: 9500 }, goals).closed).toEqual([]);
    expect(
      ringsClosedBySave(
        [...list, entry("2030-01-14", "steps", { steps: 2000 })],
        entry("2030-01-14", "sleep", { minutes: 8 * 60 }),
        goals,
      ),
    ).toEqual({ closed: ["sleep"], allClosed: true });
  });
});
