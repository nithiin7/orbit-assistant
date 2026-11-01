import type { CalendarEvent, CalendarOccurrence, Task } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import { fieldErrors } from "@/test/validation";

import {
  calendarHref,
  describeAlert,
  describeRule,
  eventItem,
  eventSchema,
  itemsOnDay,
  layoutDay,
  movedDates,
  movedTimes,
  movedToDate,
  newEventValues,
  parseCalendarLocation,
  segmentOn,
  shiftDate,
  taskItem,
  taskSchedule,
  toEventFormValues,
  toEventRequest,
  visibleRange,
} from "./calendar";

function occurrence(overrides: Partial<CalendarOccurrence> = {}): CalendarOccurrence {
  return {
    id: "e1:2030-01-14T09:00",
    event_id: "e1",
    original_start: "2030-01-14T09:00:00",
    title: "Standup",
    description: "",
    location: "",
    category_id: null,
    status: "confirmed",
    all_day: false,
    timezone: "UTC",
    start: "2030-01-14T09:00:00",
    end: "2030-01-14T09:30:00",
    start_at: "2030-01-14T09:00:00Z",
    end_at: "2030-01-14T09:30:00Z",
    recurring: false,
    modified: false,
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    workspace_id: "w1",
    title: "Write report",
    description: "",
    status: "open",
    priority: "none",
    due_date: null,
    completed_at: null,
    scheduled_start: null,
    scheduled_end: null,
    created_at: "2030-01-01T00:00:00Z",
    updated_at: "2030-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("calendar views", () => {
  it("cover whole weeks for a month, starting on the chosen day", () => {
    // January 2030 starts on a Tuesday.
    expect(visibleRange("month", "2030-01-15", 1)).toEqual({
      start: "2029-12-31",
      end: "2030-02-04",
    });
    expect(visibleRange("month", "2030-01-15", 0)).toEqual({
      start: "2029-12-30",
      end: "2030-02-03",
    });
    expect(visibleRange("week", "2030-01-15", 1)).toEqual({
      start: "2030-01-14",
      end: "2030-01-21",
    });
    expect(visibleRange("day", "2030-01-15", 1)).toEqual({
      start: "2030-01-15",
      end: "2030-01-16",
    });
  });

  it("move by a view's worth", () => {
    expect(shiftDate("month", "2030-01-31", 1)).toBe("2030-02-01");
    expect(shiftDate("week", "2030-01-15", -1)).toBe("2030-01-08");
    expect(shiftDate("day", "2030-12-31", 1)).toBe("2031-01-01");
  });

  it("keep the view and date in the URL", () => {
    const fallback = { view: "month" as const, date: "2030-01-15" };
    const read = (query: string) => parseCalendarLocation(new URLSearchParams(query), fallback);
    expect(read("view=week&date=2030-02-01")).toEqual({ view: "week", date: "2030-02-01" });
    expect(read("view=year&date=nonsense")).toEqual(fallback);
    expect(calendarHref({ view: "day", date: "2030-01-15" })).toBe(
      "/calendar?view=day&date=2030-01-15",
    );
  });
});

describe("placing items", () => {
  it("shows timed items on the viewer's clock, split across midnight", () => {
    const late = eventItem(
      occurrence({ start_at: "2030-01-14T22:00:00Z", end_at: "2030-01-15T01:00:00Z" }),
    );
    expect(segmentOn(late, "2030-01-14", "UTC")).toMatchObject({
      start: 1320,
      end: 1440,
      continuesAfter: true,
    });
    expect(segmentOn(late, "2030-01-15", "UTC")).toMatchObject({
      start: 0,
      end: 60,
      continuesBefore: true,
    });
    // In Tokyo (UTC+9) the same event is on the 15th, 07:00 to 10:00.
    expect(segmentOn(late, "2030-01-14", "Asia/Tokyo")).toBeNull();
    expect(segmentOn(late, "2030-01-15", "Asia/Tokyo")).toMatchObject({ start: 420, end: 600 });
  });

  it("puts overlapping items side by side", () => {
    const at = (id: string, start: number, end: number) => ({
      item: eventItem(occurrence({ id })),
      start,
      end,
      continuesBefore: false,
      continuesAfter: false,
    });
    const placed = layoutDay([
      at("a", 540, 600),
      at("b", 570, 630),
      at("c", 600, 660),
      at("d", 720, 780),
    ]);
    const byId = Object.fromEntries(placed.map((p) => [p.item.id, [p.column, p.columns]]));
    expect(byId).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  });

  it("lists a day's items all-day first, then by time", () => {
    const items = [
      eventItem(
        occurrence({
          id: "late",
          start_at: "2030-01-14T15:00:00Z",
          end_at: "2030-01-14T16:00:00Z",
        }),
      ),
      eventItem(
        occurrence({
          id: "trip",
          all_day: true,
          start: "2030-01-13T00:00:00",
          end: "2030-01-16T00:00:00",
        }),
      ),
      taskItem(task({ due_date: "2030-01-14" }), true),
      taskItem(
        task({
          id: "t2",
          scheduled_start: "2030-01-14T08:00:00Z",
          scheduled_end: "2030-01-14T09:00:00Z",
        }),
      ),
      eventItem(
        occurrence({
          id: "tomorrow",
          start_at: "2030-01-15T09:00:00Z",
          end_at: "2030-01-15T10:00:00Z",
        }),
      ),
    ];
    expect(itemsOnDay(items, "2030-01-14", "UTC").map((item) => item.id)).toEqual([
      "trip",
      "task:t1:due",
      "task:t2",
      "late",
    ]);
  });
});

describe("moving", () => {
  it("keeps a timed occurrence's length and converts to the event's time zone", () => {
    const paris = occurrence({
      timezone: "Europe/Paris",
      start_at: "2030-01-14T08:00:00Z",
      end_at: "2030-01-14T09:30:00Z",
    });
    // Dropped at 14:00 on a viewer in UTC: 15:00 to 16:30 in Paris.
    expect(movedTimes(paris, { date: "2030-01-15", minutes: 840, edge: "start" }, "UTC")).toEqual({
      start: "2030-01-15T15:00",
      end: "2030-01-15T16:30",
    });
    expect(movedTimes(paris, { date: "2030-01-14", minutes: 660, edge: "end" }, "UTC")).toEqual({
      start: "2030-01-14T09:00",
      end: "2030-01-14T12:00",
    });
  });

  it("keeps an all-day occurrence's span and a timed one's time of day", () => {
    const trip = occurrence({
      all_day: true,
      start: "2030-01-13T00:00:00",
      end: "2030-01-16T00:00:00",
    });
    expect(movedDates(trip, "2030-02-01")).toEqual({
      start: "2030-02-01T00:00",
      end: "2030-02-04T00:00",
    });
    expect(movedToDate(occurrence(), "2030-01-20")).toEqual({
      start: "2030-01-20T09:00",
      end: "2030-01-20T09:30",
    });
  });

  it("schedules a task block on the viewer's clock", () => {
    expect(taskSchedule("2030-01-15", 600, 90, "Asia/Kolkata")).toEqual({
      scheduled_start: "2030-01-15T04:30:00.000Z",
      scheduled_end: "2030-01-15T06:00:00.000Z",
    });
  });
});

describe("event form", () => {
  it("builds requests for timed, all-day, and repeating events", () => {
    const values = {
      ...newEventValues("Europe/Paris", { date: "2030-01-14", minutes: 600 }),
      title: " Review ",
    };
    expect(toEventRequest(values)).toMatchObject({
      title: "Review",
      start: "2030-01-14T10:00",
      end: "2030-01-14T11:00",
      timezone: "Europe/Paris",
      all_day: false,
      recurrence: null,
    });
    expect(toEventRequest({ ...values, allDay: true, endDate: "2030-01-16" })).toMatchObject({
      start: "2030-01-14T00:00",
      end: "2030-01-17T00:00",
    });
    // 14 Jan 2030 is a Monday, which a weekly rule always includes.
    expect(
      toEventRequest({
        ...values,
        repeat: "weekly",
        interval: 2,
        weekdays: ["wed"],
        ends: "count",
        count: 4,
      }).recurrence,
    ).toEqual({
      frequency: "weekly",
      interval: 2,
      weekdays: ["mon", "wed"],
      count: 4,
      until: null,
    });
  });

  it("reads an event back into the form", () => {
    const event = {
      id: "e1",
      title: "Trip",
      description: "",
      location: "",
      category_id: null,
      all_day: true,
      timezone: "UTC",
      start: "2030-03-01T00:00:00",
      end: "2030-03-04T00:00:00",
      recurrence: {
        frequency: "yearly",
        interval: 1,
        weekdays: [],
        count: null,
        until: "2035-01-01",
      },
      alerts: [1440],
    } as unknown as CalendarEvent;
    expect(toEventFormValues(event)).toMatchObject({
      allDay: true,
      startDate: "2030-03-01",
      endDate: "2030-03-03",
      repeat: "yearly",
      ends: "until",
      until: "2035-01-01",
      alerts: [1440],
    });
  });

  it("validates like the API", () => {
    const values = { ...newEventValues("UTC", { date: "2030-01-14" }), title: "X" };
    expect(fieldErrors(eventSchema, values)).toEqual({});
    expect(fieldErrors(eventSchema, { ...values, title: " " })).toHaveProperty("title");
    expect(fieldErrors(eventSchema, { ...values, endTime: "08:00" })).toHaveProperty("endDate");
    expect(
      fieldErrors(eventSchema, { ...values, ends: "until", until: "2030-01-01" }),
    ).toHaveProperty("until");
    expect(fieldErrors(eventSchema, { ...values, repeat: "weekly", weekdays: [] })).toHaveProperty(
      "weekdays",
    );
    expect(fieldErrors(eventSchema, { ...values, alerts: [0, 5, 10, 15, 30, 60] })).toHaveProperty(
      "alerts",
    );
  });
});

describe("labels", () => {
  it("describe rules and alerts", () => {
    expect(
      describeRule({ frequency: "weekly", interval: 2, weekdays: ["mon", "wed"] }, "2030-01-14"),
    ).toBe("Every 2 weeks on Mon, Wed");
    expect(describeRule({ frequency: "monthly", interval: 1, count: 6 }, "2030-01-31")).toBe(
      "Every month on day 31 (or the month’s last day), 6 times",
    );
    expect(describeRule(null, "2030-01-31")).toBe("Does not repeat");
    expect([0, 15, 60, 90, 1440, 2880].map(describeAlert)).toEqual([
      "At start",
      "15 minutes before",
      "1 hour before",
      "90 minutes before",
      "1 day before",
      "2 days before",
    ]);
  });
});
