import type { Activity, ActivityKind, FitnessProfile } from "@orbit/contracts";

import { addDays } from "@/utils/dates";

/** The three daily rings, outermost first. */
export type RingKey = "active" | "steps" | "sleep";

export const RING_KEYS: readonly RingKey[] = ["active", "steps", "sleep"];

export type ActivityGoals = { steps: number; active_s: number; sleep_s: number };

/** Used for any ring the person hasn't set a goal for. */
export const DEFAULT_ACTIVITY_GOALS: ActivityGoals = {
  steps: 10_000,
  active_s: 30 * 60,
  sleep_s: 8 * 60 * 60,
};

/** Kinds that count as active time for the Active ring. */
export const ACTIVE_KINDS: readonly ActivityKind[] = ["walk", "run", "cycle", "swim", "cardio"];

export function activityGoals(
  targets: FitnessProfile["targets"] | null | undefined,
): ActivityGoals {
  return {
    steps: targets?.steps ?? DEFAULT_ACTIVITY_GOALS.steps,
    active_s: targets?.active_s ?? DEFAULT_ACTIVITY_GOALS.active_s,
    sleep_s: targets?.sleep_s ?? DEFAULT_ACTIVITY_GOALS.sleep_s,
  };
}

type Entry = Pick<Activity, "day" | "kind" | "steps" | "distance_m" | "duration_s">;

export type DayTotals = {
  steps: number;
  active_s: number;
  sleep_s: number;
  distance_m: number;
  rest: boolean;
  entries: number;
};

const EMPTY_DAY: DayTotals = {
  steps: 0,
  active_s: 0,
  sleep_s: 0,
  distance_m: 0,
  rest: false,
  entries: 0,
};

function addEntry(totals: DayTotals, entry: Entry): DayTotals {
  const active = ACTIVE_KINDS.includes(entry.kind);
  return {
    steps: totals.steps + (entry.kind === "steps" ? (entry.steps ?? 0) : 0),
    active_s: totals.active_s + (active ? (entry.duration_s ?? 0) : 0),
    sleep_s: totals.sleep_s + (entry.kind === "sleep" ? (entry.duration_s ?? 0) : 0),
    distance_m: totals.distance_m + (active ? (entry.distance_m ?? 0) : 0),
    rest: totals.rest || entry.kind === "rest_day",
    entries: totals.entries + 1,
  };
}

/** Each day's totals, by `YYYY-MM-DD`. Days with nothing logged are absent. */
export function totalsByDay(entries: readonly Entry[]): Map<string, DayTotals> {
  const days = new Map<string, DayTotals>();
  for (const entry of entries) {
    days.set(entry.day, addEntry(days.get(entry.day) ?? EMPTY_DAY, entry));
  }
  return days;
}

export function dayTotals(days: Map<string, DayTotals>, day: string): DayTotals {
  return days.get(day) ?? EMPTY_DAY;
}

/** Each ring's share of its goal. Above 1 when the goal is passed. */
export type RingProgress = Record<RingKey, number>;

export function ringProgress(totals: DayTotals, goals: ActivityGoals): RingProgress {
  return {
    active: totals.active_s / goals.active_s,
    steps: totals.steps / goals.steps,
    sleep: totals.sleep_s / goals.sleep_s,
  };
}

export function closedRings(progress: RingProgress): RingKey[] {
  return RING_KEYS.filter((key) => progress[key] >= 1);
}

/** The `count` days ending on `today`, oldest first. */
export function recentDays(today: string, count = 7): string[] {
  return Array.from({ length: count }, (_, index) => addDays(today, index - count + 1));
}

/**
 * Days in a row with at least one ring closed, ending today. Today only counts once it has a
 * closed ring, so the streak doesn't look broken in the morning. Rest days keep a streak going
 * without adding to it.
 */
export function ringStreak(days: Map<string, DayTotals>, goals: ActivityGoals, today: string) {
  let streak = 0;
  for (let offset = 0; offset < 366; offset += 1) {
    const day = addDays(today, -offset);
    const totals = dayTotals(days, day);
    if (closedRings(ringProgress(totals, goals)).length > 0) streak += 1;
    else if (totals.rest) continue;
    else if (offset > 0) break;
  }
  return streak;
}

export type PeriodSummary = {
  steps: number;
  active_s: number;
  distance_m: number;
  /** Average over the nights with sleep logged, or `null` with none. */
  averageSleep_s: number | null;
  /** Days with every ring closed. */
  perfectDays: number;
};

export function summarizeDays(
  days: Map<string, DayTotals>,
  goals: ActivityGoals,
  range: readonly string[],
): PeriodSummary {
  let steps = 0;
  let active = 0;
  let distance = 0;
  let sleep = 0;
  let nights = 0;
  let perfect = 0;
  for (const day of range) {
    const totals = dayTotals(days, day);
    steps += totals.steps;
    active += totals.active_s;
    distance += totals.distance_m;
    if (totals.sleep_s > 0) {
      sleep += totals.sleep_s;
      nights += 1;
    }
    if (closedRings(ringProgress(totals, goals)).length === RING_KEYS.length) perfect += 1;
  }
  return {
    steps,
    active_s: active,
    distance_m: distance,
    averageSleep_s: nights > 0 ? Math.round(sleep / nights) : null,
    perfectDays: perfect,
  };
}

/**
 * The rings a save newly closes on its day, comparing the day before and after replacing the
 * edited entry (if any) with the saved one, and whether every ring is closed after it.
 */
export function ringsClosedBySave(
  entries: readonly (Entry & { id: string })[],
  saved: Entry & { id: string },
  goals: ActivityGoals,
): { closed: RingKey[]; allClosed: boolean } {
  const before = entries.filter((entry) => entry.day === saved.day);
  const after = [...before.filter((entry) => entry.id !== saved.id), saved];
  const was = closedRings(ringProgress(dayTotals(totalsByDay(before), saved.day), goals));
  const now = closedRings(ringProgress(dayTotals(totalsByDay(after), saved.day), goals));
  return {
    closed: now.filter((key) => !was.includes(key)),
    allClosed: now.length === RING_KEYS.length,
  };
}
