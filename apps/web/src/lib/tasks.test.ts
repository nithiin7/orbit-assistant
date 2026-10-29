import { describe, expect, it } from "vitest";

import {
  daysBetween,
  DEFAULT_TASK_FILTERS,
  describeDueDate,
  isNarrowed,
  localDateString,
  TASK_PAGE_SIZE,
  toTaskListQuery,
  validateTaskDescription,
  validateTaskTitle,
} from "./tasks";

describe("toTaskListQuery", () => {
  it("sends only the filters that narrow the list", () => {
    expect(toTaskListQuery(DEFAULT_TASK_FILTERS)).toEqual({
      status: "open",
      priority: undefined,
      q: undefined,
      sort: "due_date",
      limit: TASK_PAGE_SIZE,
    });
  });

  it("maps every filter", () => {
    expect(
      toTaskListQuery({ status: "all", priority: "high", search: "rent", sort: "priority" }),
    ).toEqual({
      status: undefined,
      priority: ["high"],
      q: "rent",
      sort: "priority",
      limit: TASK_PAGE_SIZE,
    });
  });
});

describe("isNarrowed", () => {
  it("ignores the status view and sort", () => {
    expect(isNarrowed({ ...DEFAULT_TASK_FILTERS, status: "completed", sort: "priority" })).toBe(
      false,
    );
    expect(isNarrowed({ ...DEFAULT_TASK_FILTERS, search: "rent" })).toBe(true);
    expect(isNarrowed({ ...DEFAULT_TASK_FILTERS, priority: "low" })).toBe(true);
  });
});

describe("validateTaskTitle", () => {
  it.each([
    ["", "Enter a title."],
    ["   ", "Enter a title."],
    ["x".repeat(201), "Use 200 characters or fewer."],
    ["Two\nlines", "Remove line breaks and unsupported characters."],
  ])("rejects %j", (title, message) => {
    expect(validateTaskTitle(title)).toBe(message);
  });

  it("accepts titles the API accepts", () => {
    expect(validateTaskTitle(`  ${"x".repeat(200)}  `)).toBeUndefined();
    expect(validateTaskTitle("Dinner 👨‍👩‍👧 at 7")).toBeUndefined();
  });
});

describe("validateTaskDescription", () => {
  it("allows line breaks and tabs but not other control characters", () => {
    expect(validateTaskDescription("")).toBeUndefined();
    expect(validateTaskDescription("Line one\n\tLine two\r\n")).toBeUndefined();
    expect(validateTaskDescription("Bell\u0007")).toBe("Remove unsupported characters.");
    expect(validateTaskDescription("x".repeat(5001))).toBe("Use 5000 characters or fewer.");
  });
});

describe("dates", () => {
  it("formats local dates like the API's due dates", () => {
    expect(localDateString(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });

  it("counts calendar days across month and year ends", () => {
    expect(daysBetween("2026-10-29", "2026-10-29")).toBe(0);
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-03-01", "2026-02-28")).toBe(-1);
  });

  it.each([
    ["2026-10-29", { state: "today", label: "Today" }],
    ["2026-10-30", { state: "soon", label: "Tomorrow" }],
    ["2026-10-28", { state: "overdue", label: "Yesterday" }],
  ])("describes %s relative to 2026-10-29", (due, expected) => {
    expect(describeDueDate(due, "2026-10-29")).toEqual(expected);
  });

  it("classifies dates further away", () => {
    expect(describeDueDate("2026-10-01", "2026-10-29").state).toBe("overdue");
    expect(describeDueDate("2026-11-03", "2026-10-29").state).toBe("soon");
    expect(describeDueDate("2026-11-20", "2026-10-29").state).toBe("later");
    expect(describeDueDate("2027-02-01", "2026-10-29").label).toMatch(/2027/);
    expect(describeDueDate("2026-11-20", "2026-10-29").label).not.toMatch(/2026/);
  });
});
