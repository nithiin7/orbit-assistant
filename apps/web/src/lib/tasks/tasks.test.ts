import { describe, expect, it } from "vitest";

import { fieldErrors } from "@/test/validation";

import {
  DEFAULT_TASK_FILTERS,
  describeDueDate,
  groupTasksByDue,
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

describe("groupTasksByDue", () => {
  const today = "2026-10-30";
  const due = (id: string, dueDate: string | null) => ({ id, due_date: dueDate });

  it("puts each task in the section for its due date, soonest section first", () => {
    const groups = groupTasksByDue(
      [
        due("none", null),
        due("later", "2026-11-06"),
        due("week", "2026-11-05"),
        due("tomorrow", "2026-10-31"),
        due("today", "2026-10-30"),
        due("overdue", "2026-10-29"),
      ],
      today,
    );

    expect(groups.map((group) => [group.label, group.tasks.map((task) => task.id)])).toEqual([
      ["Overdue", ["overdue"]],
      ["Today", ["today"]],
      ["Tomorrow", ["tomorrow"]],
      ["Next 7 days", ["week"]],
      ["Later", ["later"]],
      ["No due date", ["none"]],
    ]);
  });

  it("keeps the given order within a section and leaves out empty sections", () => {
    const groups = groupTasksByDue(
      [due("b", "2026-10-30"), due("a", "2026-10-30"), due("c", null)],
      today,
    );

    expect(groups.map((group) => group.key)).toEqual(["today", "none"]);
    expect(groups[0]?.tasks.map((task) => task.id)).toEqual(["b", "a"]);
  });

  it("returns no sections for no tasks", () => {
    expect(groupTasksByDue([], today)).toEqual([]);
  });
});
