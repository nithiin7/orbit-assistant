import type { Reminder } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  describeRecurrence,
  formatOccurrence,
  nextHour,
  reminderSchema,
  statusHint,
  toFormValues,
  toRecurrence,
  toReminderRequest,
  toRepeat,
  weekdayOf,
} from "./reminders";

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "r1",
    workspace_id: "w1",
    task: null,
    title: "Call the dentist",
    description: "",
    enabled: true,
    start_date: "2030-01-15",
    time_of_day: "09:00:00",
    timezone: "Europe/Paris",
    recurrence: null,
    status: "scheduled",
    next_occurrence_at: "2030-01-15T08:00:00Z",
    last_occurrence_at: null,
    last_outcome: null,
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

describe("weekdayOf", () => {
  it("names a calendar date's weekday whatever the viewer's time zone", () => {
    expect(weekdayOf("2030-01-14")).toBe("mon");
    expect(weekdayOf("2030-01-20")).toBe("sun");
    expect(weekdayOf("2028-02-29")).toBe("tue");
  });
});

describe("recurrence presets", () => {
  it("map the form's choices to the API's recurrence and back", () => {
    expect(toRecurrence("none", [])).toBeNull();
    expect(toRecurrence("daily", ["mon"])).toEqual({ frequency: "daily", weekdays: [] });
    expect(toRecurrence("weekdays", [])).toEqual({
      frequency: "weekly",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
    });
    // Weekday order, whatever order they were picked in.
    expect(toRecurrence("weekly", ["sun", "mon"])).toEqual({
      frequency: "weekly",
      weekdays: ["mon", "sun"],
    });

    expect(toRepeat(null)).toBe("none");
    expect(toRepeat({ frequency: "monthly", weekdays: [] })).toBe("monthly");
    expect(toRepeat({ frequency: "weekly", weekdays: ["fri", "mon", "tue", "wed", "thu"] })).toBe(
      "weekdays",
    );
    expect(toRepeat({ frequency: "weekly", weekdays: ["mon"] })).toBe("weekly");
  });

  it("describe how a reminder repeats", () => {
    expect(describeRecurrence(null, "2030-01-15")).toBe("Once");
    expect(describeRecurrence({ frequency: "daily", weekdays: [] }, "2030-01-15")).toBe(
      "Every day",
    );
    expect(
      describeRecurrence(
        { frequency: "weekly", weekdays: ["mon", "tue", "wed", "thu", "fri"] },
        "2030-01-15",
      ),
    ).toBe("Every weekday");
    expect(
      describeRecurrence({ frequency: "weekly", weekdays: ["mon", "thu"] }, "2030-01-15"),
    ).toBe("Weekly on Mon, Thu");
    expect(describeRecurrence({ frequency: "monthly", weekdays: [] }, "2030-01-02")).toBe(
      "Monthly on the 2nd",
    );
    expect(describeRecurrence({ frequency: "monthly", weekdays: [] }, "2030-01-31")).toBe(
      "Monthly on the 31st (or the month’s last day)",
    );
  });
});

describe("nextHour", () => {
  it("suggests the next whole hour in the reminder's zone", () => {
    expect(nextHour("Asia/Kolkata", new Date("2030-01-15T08:10:00Z"))).toEqual({
      date: "2030-01-15",
      time: "14:30",
    });
    expect(nextHour("UTC", new Date("2030-01-15T23:00:00Z"))).toEqual({
      date: "2030-01-16",
      time: "00:00",
    });
  });
});

describe("formatOccurrence", () => {
  const now = new Date("2030-01-15T06:00:00Z");

  it("names today and tomorrow on the reminder's own clock", () => {
    expect(formatOccurrence("2030-01-15T08:00:00Z", "Europe/Paris", now)).toMatch(/^Today, 9:00/);
    expect(formatOccurrence("2030-01-16T08:00:00Z", "Europe/Paris", now)).toMatch(
      /^Tomorrow, 9:00/,
    );
    // 23:30 UTC on the 15th is already the 16th in Tokyo.
    expect(formatOccurrence("2030-01-15T23:30:00Z", "Asia/Tokyo", now)).toMatch(/^Tomorrow, 8:30/);
  });

  it("gives later dates in full, with the year when it differs", () => {
    expect(formatOccurrence("2030-01-22T08:00:00Z", "Europe/Paris", now)).toMatch(/Jan 22/);
    expect(formatOccurrence("2031-02-01T08:00:00Z", "Europe/Paris", now)).toMatch(/2031/);
  });
});

describe("reminder form", () => {
  it("round-trips an existing reminder through the form values", () => {
    const weekly = reminder({
      recurrence: { frequency: "weekly", weekdays: ["mon", "wed"] },
      task: { id: "t1", title: "Taxes", status: "open" },
    });

    const values = toFormValues(weekly);

    expect(values).toEqual({
      title: "Call the dentist",
      description: "",
      taskId: "t1",
      date: "2030-01-15",
      time: "09:00",
      timeZone: "Europe/Paris",
      repeat: "weekly",
      weekdays: ["mon", "wed"],
    });
    expect(toReminderRequest(values)).toEqual({
      title: "Call the dentist",
      description: "",
      task_id: "t1",
      start_date: "2030-01-15",
      time_of_day: "09:00",
      timezone: "Europe/Paris",
      recurrence: { frequency: "weekly", weekdays: ["mon", "wed"] },
    });
    expect(toReminderRequest({ ...values, taskId: "", repeat: "none" })).toMatchObject({
      task_id: null,
      recurrence: null,
    });
  });

  it("requires a title, a time, and a day for weekly reminders", async () => {
    const values = { ...toFormValues(reminder()), repeat: "weekly" as const, weekdays: [] };

    await expect(reminderSchema.validate(values)).rejects.toThrow("Choose at least one day.");
    await expect(
      reminderSchema.validate({ ...values, repeat: "daily", title: "  " }),
    ).rejects.toThrow("Enter a title.");
    await expect(reminderSchema.validate({ ...values, repeat: "daily", time: "" })).rejects.toThrow(
      "Choose a time.",
    );
    await expect(reminderSchema.validate({ ...values, repeat: "daily" })).resolves.toBeTruthy();
  });
});

describe("statusHint", () => {
  it("explains reminders that won't fire as expected", () => {
    expect(statusHint(reminder())).toBeNull();
    expect(statusHint(reminder({ status: "overdue", last_outcome: "failed" }))).toMatch(/failed/);
    expect(statusHint(reminder({ status: "overdue" }))).toMatch(/shortly/);
    expect(
      statusHint(
        reminder({ status: "completed", task: { id: "t", title: "T", status: "completed" } }),
      ),
    ).toMatch(/task is completed/);
  });
});
