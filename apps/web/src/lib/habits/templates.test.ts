import type { Habit } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import { cheerFor, habitSchema, habitSection, routineSchema, toCreateHabitRequest } from "./habits";
import {
  describeHabitTemplate,
  describeRoutineTemplate,
  HABIT_TEMPLATES,
  habitTemplateValues,
  ROUTINE_TEMPLATES,
  routineTemplateValues,
  STARTER_TEMPLATE_IDS,
} from "./templates";

describe("habit templates", () => {
  it("each fills a form that passes validation", async () => {
    for (const template of HABIT_TEMPLATES) {
      await expect(
        habitSchema.validate(habitTemplateValues(template, "2030-01-14", "UTC")),
      ).resolves.toBeDefined();
    }
    for (const template of ROUTINE_TEMPLATES) {
      await expect(
        routineSchema.validate(routineTemplateValues(template, "UTC")),
      ).resolves.toBeDefined();
    }
  });

  it("have unique IDs, and the starters exist", () => {
    const ids = HABIT_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of STARTER_TEMPLATE_IDS) expect(ids).toContain(id);
  });

  it("build the request the form would send", () => {
    const water = HABIT_TEMPLATES.find((template) => template.id === "drink-water");
    if (!water) throw new Error("missing template");
    expect(toCreateHabitRequest(habitTemplateValues(water, "2030-01-14", "UTC"))).toMatchObject({
      name: "Drink water",
      kind: "numeric",
      target: 8,
      unit: "glasses",
      schedule: { type: "daily", every: 1 },
    });
  });

  it("describe their target and schedule", () => {
    const byId = (id: string) => HABIT_TEMPLATES.find((template) => template.id === id);
    const water = byId("drink-water");
    const workout = byId("workout");
    if (!water || !workout) throw new Error("missing template");
    expect(describeHabitTemplate(water)).toMatch(/^8 glasses · Every day$/);
    expect(describeHabitTemplate(workout)).toBe("3 times a week");
    const morning = ROUTINE_TEMPLATES[0];
    if (!morning) throw new Error("missing template");
    expect(describeRoutineTemplate(morning)).toBe("4 steps · 13 min");
  });
});

describe("habitSection", () => {
  it("puts detail pages under their list", () => {
    expect(habitSection({ kind: "habit", id: "h1" })).toBe("all");
    expect(habitSection({ kind: "routine", id: "r1" })).toBe("routines");
    expect(habitSection({ kind: "view", view: "templates" })).toBe("templates");
  });
});

describe("cheerFor", () => {
  const habit = { name: "Read" } as Habit;

  it("celebrates a finished day loudest", () => {
    const cheer = cheerFor(
      { habit, current_streak: 7, streak_unit: "day" },
      { allDone: true, doneToday: 2 },
    );
    expect(cheer).toMatchObject({ title: "All done for today!", big: true });
  });

  it("marks streak milestones", () => {
    const cheer = cheerFor(
      { habit, current_streak: 7, streak_unit: "day" },
      { allDone: false, doneToday: 0 },
    );
    expect(cheer).toMatchObject({ title: "7-day streak!", big: true });
    expect(cheer.message).toContain("Read, 7 days running");
  });

  it("varies the everyday cheer and mentions the streak", () => {
    const first = cheerFor(
      { habit, current_streak: 4, streak_unit: "day" },
      { allDone: false, doneToday: 0 },
    );
    const second = cheerFor(
      { habit, current_streak: 1, streak_unit: "day" },
      { allDone: false, doneToday: 1 },
    );
    expect(first).toMatchObject({ title: "Yay, target met!", big: false });
    expect(first.message).toBe("Read is done. That’s a 4-day streak.");
    expect(second.title).not.toBe(first.title);
    expect(second.message).toBe("Read is done for today.");
  });
});
