import type { Habit, HabitSchedule } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  describeProgress,
  describeSchedule,
  describeTarget,
  formatRate,
  habitSchema,
  habitsHref,
  heatLevel,
  isRemaining,
  newHabitValues,
  parseHabitLocation,
  routineDoneOn,
  toCreateHabitRequest,
  toHabitFormValues,
  toUpdateHabitRequest,
} from "./habits";

const habit = {
  kind: "numeric",
  target: 3,
  unit: "litres",
  schedule: { type: "daily", every: 1, weekdays: [], month_days: [], times_per_week: 0 },
} as const;

function schedule(fields: Partial<HabitSchedule> & Pick<HabitSchedule, "type">): HabitSchedule {
  return { every: 1, weekdays: [], month_days: [], times_per_week: 0, ...fields };
}

describe("schedules", () => {
  it.each<[HabitSchedule, string]>([
    [schedule({ type: "daily" }), "Every day"],
    [schedule({ type: "daily", every: 3 }), "Every 3 days"],
    [schedule({ type: "weekdays", weekdays: ["mon", "wed", "fri"] }), "Mon, Wed, Fri"],
    [schedule({ type: "weekdays", weekdays: ["mon", "tue", "wed", "thu", "fri"] }), "Weekdays"],
    [schedule({ type: "monthly", month_days: [1, 15] }), "On the 1st and 15th"],
    [schedule({ type: "weekly_target", times_per_week: 4 }), "4 times a week"],
  ])("describes %o as %s", (value, text) => {
    expect(describeSchedule(value)).toBe(text);
  });
});

describe("targets and progress", () => {
  it("describes amounts and durations", () => {
    expect(describeTarget(habit)).toBe("3 litres");
    expect(describeTarget({ kind: "duration", target: 90, unit: "" })).toBe("1 h 30 min");
    expect(describeTarget({ kind: "boolean", target: null, unit: "" })).toBeNull();
    expect(describeProgress(habit, 1.5)).toBe("1.5 of 3 litres");
  });

  it("formats rates without inventing a 0%", () => {
    expect(formatRate(0.834)).toBe("83%");
    expect(formatRate(null)).toBe("—");
  });

  it("treats open weekly targets as remaining until met", () => {
    expect(isRemaining({ state: "open", period: { state: "pending" } as never })).toBe(true);
    expect(isRemaining({ state: "open", period: { state: "met" } as never })).toBe(false);
    expect(isRemaining({ state: "unscheduled", period: null })).toBe(false);
  });

  it("shades heatmap days by what was due", () => {
    expect(heatLevel({ day: "", due: 0, completed: 0, extra: 0 })).toBe(0);
    expect(heatLevel({ day: "", due: 0, completed: 0, extra: 1 })).toBe(2);
    expect(heatLevel({ day: "", due: 4, completed: 4, extra: 0 })).toBe(4);
    expect(heatLevel({ day: "", due: 3, completed: 1, extra: 0 })).toBe(1);
  });
});

describe("routineDoneOn", () => {
  const last = (status: "active" | "completed" | "abandoned", day: string) => ({
    last_session: { status, day },
  });
  it("is done only when the latest session completed that day", () => {
    expect(routineDoneOn(last("completed", "2030-01-14"), "2030-01-14")).toBe(true);
    expect(routineDoneOn(last("completed", "2030-01-13"), "2030-01-14")).toBe(false);
    expect(routineDoneOn(last("abandoned", "2030-01-14"), "2030-01-14")).toBe(false);
    expect(routineDoneOn({ last_session: null }, "2030-01-14")).toBe(false);
  });
});

describe("locations", () => {
  it("round-trips views and detail pages", () => {
    expect(parseHabitLocation(new URLSearchParams("view=analytics"))).toEqual({
      kind: "view",
      view: "analytics",
    });
    expect(parseHabitLocation(new URLSearchParams("view=nope"))).toEqual({
      kind: "view",
      view: "today",
    });
    expect(habitsHref({ kind: "habit", id: "h1" })).toBe("/habits?habit=h1");
    expect(habitsHref({ kind: "view", view: "today" })).toBe("/habits");
  });
});

describe("the habit form", () => {
  it("requires a target for amounts and days for weekday schedules", async () => {
    const values = {
      ...newHabitValues("2030-01-14", "UTC"),
      name: "Water",
      kind: "numeric" as const,
    };
    await expect(habitSchema.validate(values)).rejects.toThrow("Enter a target above zero.");
    const weekdays = {
      ...values,
      kind: "boolean" as const,
      scheduleType: "weekdays" as const,
      weekdays: [],
    };
    await expect(habitSchema.validate(weekdays)).rejects.toThrow("Choose at least one day.");
  });

  it("builds requests, and only sends a schedule when it changed", () => {
    const values = {
      ...newHabitValues("2030-01-14", "UTC"),
      name: "Read",
      reminders: [{ time: "07:00", weekdays: [] }],
    };
    const request = toCreateHabitRequest(values);
    expect(request.schedule).toEqual(schedule({ type: "daily" }));
    expect(request.target).toBeNull();

    const saved = {
      ...request,
      id: "h1",
      target: null,
      schedule: { type: "daily", every: 1, weekdays: [], month_days: [], times_per_week: 0 },
    } as unknown as Habit;
    const form = toHabitFormValues(saved, [{ time: "07:00:00" }]);
    expect(toUpdateHabitRequest(saved, form).changes.schedule).toBeUndefined();
    const moved = toUpdateHabitRequest(saved, { ...form, every: "2" });
    expect(moved.changes.schedule).toEqual(schedule({ type: "daily", every: 2 }));
    expect(moved.reminders).toEqual([{ time: "07:00", weekdays: [] }]);
  });
});
