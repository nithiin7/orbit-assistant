import { describe, expect, it } from "vitest";

import { fieldErrors } from "@/test/validation";

import {
  DEFAULT_TASK_FILTERS,
  describeDueDate,
  isNarrowed,
  TASK_PAGE_SIZE,
  taskSchema,
  toTaskListQuery,
} from "./tasks";

const validTask = { title: "Pay rent", description: "", dueDate: "", priority: "none" };
const taskErrors = (changes: Partial<typeof validTask>) =>
  fieldErrors(taskSchema, { ...validTask, ...changes });

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

describe("task title", () => {
  it.each([
    ["", "Enter a title."],
    ["   ", "Enter a title."],
    ["x".repeat(201), "Use 200 characters or fewer."],
    ["Two\nlines", "Remove line breaks and unsupported characters."],
  ])("rejects %j", (title, message) => {
    expect(taskErrors({ title }).title).toBe(message);
  });

  it("accepts titles the API accepts", () => {
    expect(taskErrors({ title: `  ${"x".repeat(200)}  ` })).toEqual({});
    expect(taskErrors({ title: "Dinner 👨‍👩‍👧 at 7" })).toEqual({});
  });
});

describe("taskSchema", () => {
  it("submits trimmed text", () => {
    expect(
      taskSchema.validateSync({ ...validTask, title: "  Pay rent ", description: " Today\n" }),
    ).toMatchObject({ title: "Pay rent", description: "Today" });
  });

  it("accepts only the API's priorities", () => {
    expect(taskErrors({ priority: "urgent" }).priority).toBeDefined();
  });
});

describe("task description", () => {
  it("allows line breaks and tabs but not other control characters", () => {
    expect(taskErrors({ description: "" })).toEqual({});
    expect(taskErrors({ description: "Line one\n\tLine two\r\n" })).toEqual({});
    expect(taskErrors({ description: "Bell\u0007" }).description).toBe(
      "Remove unsupported characters.",
    );
    expect(taskErrors({ description: "x".repeat(5001) }).description).toBe(
      "Use 5000 characters or fewer.",
    );
  });
});

describe("describeDueDate", () => {
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
