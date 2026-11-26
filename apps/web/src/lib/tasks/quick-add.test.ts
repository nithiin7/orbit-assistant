import { describe, expect, it } from "vitest";

import { parseQuickAdd, type QuickAddKind } from "./quick-add";

// A Thursday.
const today = "2026-11-26";
const lists = [
  { id: "l-work", name: "Work" },
  { id: "l-home", name: "Home projects" },
  { id: "l-hobby", name: "Hobbies" },
];

const parse = (input: string, ignore?: QuickAddKind[]) =>
  parseQuickAdd(input, { today, lists, ignore: new Set(ignore) });
const due = (input: string) => parse(input).dueDate;

describe("parseQuickAdd", () => {
  it("leaves a plain title alone", () => {
    expect(parse("Water the plants")).toEqual({
      title: "Water the plants",
      dueDate: null,
      recurrence: null,
      priority: null,
      listId: null,
      tokens: [],
    });
  });

  it("reads relative days and drops the words that introduce them", () => {
    expect(parse("Call mom tomorrow")).toMatchObject({
      title: "Call mom",
      dueDate: "2026-11-27",
      tokens: [{ kind: "date", text: "tomorrow", label: "Tomorrow" }],
    });
    expect(parse("Submit report due today")).toMatchObject({
      title: "Submit report",
      dueDate: today,
      tokens: [{ text: "due today", label: "Today" }],
    });
    expect(due("Plan trip in 3 days")).toBe("2026-11-29");
    expect(due("Renew pass in a week")).toBe("2026-12-03");
    expect(due("Dentist in 2 months")).toBe("2027-01-26");
  });

  it("reads weekdays, counting today, and next week's", () => {
    expect(due("Standup thursday")).toBe(today);
    expect(due("Pay invoice fri")).toBe("2026-11-27");
    expect(due("Groceries on monday")).toBe("2026-11-30");
    // Friday of next week, not tomorrow.
    expect(due("Review next friday")).toBe("2026-12-04");
    expect(due("Plan sprint next week")).toBe("2026-11-30");
    expect(due("Budget next month")).toBe("2026-12-01");
    expect(due("Clean garage this weekend")).toBe("2026-11-28");
    expect(parse("Pay invoice fri").tokens[0]?.label).toBe("Tomorrow");
    expect(parse("Groceries on monday").tokens[0]?.label).toMatch(/^Mon, /);
  });

  it("only reads short weekdays that are also words after a lead word", () => {
    expect(parse("Buy sun cream").tokens).toEqual([]);
    expect(parse("Sat exam prep").tokens).toEqual([]);
    expect(due("Brunch on sat")).toBe("2026-11-28");
  });

  it("reads calendar dates, rolling past ones into next year", () => {
    expect(due("Party dec 5")).toBe("2026-12-05");
    expect(due("Taxes march 31st")).toBe("2027-03-31");
    expect(due("Trip 5th of january")).toBe("2027-01-05");
    expect(due("Launch 2027-02-14")).toBe("2027-02-14");
    expect(due("Launch dec 5 2027")).toBe("2027-12-05");
    expect(parse("Launch 2027-02-30").tokens).toEqual([]);
    expect(parse("Plan Feb 30").tokens).toEqual([]);
    // "5 may" reads as a date only when it clearly is one.
    expect(parse("Order 5 may need more").tokens).toEqual([]);
    expect(due("Order by 5 may")).toBe("2027-05-05");
  });

  it("reads a day of the month only after a lead word, skipping short months", () => {
    expect(due("Pay rent on the 1st")).toBe("2026-12-01");
    expect(due("Report by 30th")).toBe("2026-11-30");
    expect(parse("Finish 5th draft").tokens).toEqual([]);
    expect(parseQuickAdd("Bill on the 31st", { today: "2027-02-10" }).dueDate).toBe("2027-03-31");
  });

  it("reads repeats, starting today unless a date or weekday says otherwise", () => {
    expect(parse("Water plants every day")).toMatchObject({
      title: "Water plants",
      dueDate: today,
      recurrence: { frequency: "daily", interval: 1 },
      tokens: [{ kind: "repeat", label: "Every day, from today" }],
    });
    expect(parse("Team sync every monday")).toMatchObject({
      dueDate: "2026-11-30",
      recurrence: { frequency: "weekly", interval: 1 },
    });
    expect(parse("Pay rent on the 1st every month")).toMatchObject({
      title: "Pay rent",
      dueDate: "2026-12-01",
      recurrence: { frequency: "monthly", interval: 1 },
      tokens: [
        { kind: "date", text: "on the 1st" },
        { kind: "repeat", text: "every month", label: "Every month" },
      ],
    });
    expect(parse("Payslip every other week").recurrence).toEqual({
      frequency: "weekly",
      interval: 2,
    });
    expect(parse("Backup every 3 days").recurrence).toEqual({ frequency: "daily", interval: 3 });
    expect(parse("Review weekly").recurrence).toEqual({ frequency: "weekly", interval: 1 });
    expect(parse("Insurance annually").recurrence).toEqual({ frequency: "yearly", interval: 1 });
    expect(parse("Ask every 100 days").recurrence).toBeNull();
  });

  it("reads priority marks", () => {
    expect(parse("Fix leak !high")).toMatchObject({ title: "Fix leak", priority: "high" });
    expect(parse("Fix leak !!")).toMatchObject({ priority: "medium" });
    expect(parse("Tidy desk p3")).toMatchObject({ priority: "low" });
    expect(parse("Tidy desk P1").priority).toBe("high");
  });

  it("matches #list against the workspace's lists", () => {
    expect(parse("Email Sam #work")).toMatchObject({
      title: "Email Sam",
      listId: "l-work",
      tokens: [{ kind: "list", label: "Work" }],
    });
    expect(parse("Paint fence #homeprojects").listId).toBe("l-home");
    // A unique prefix is enough; an ambiguous or unknown tag stays in the title.
    expect(parse("Knit #hobb").listId).toBe("l-hobby");
    expect(parse("Plan #hom").listId).toBe("l-home");
    expect(parse("Plan #ho").listId).toBeNull();
    expect(parse("Watch talk #conference")).toMatchObject({
      title: "Watch talk #conference",
      listId: null,
    });
  });

  it("reads everything at once, keeping the first phrase of each kind", () => {
    expect(parse("Pay rent tomorrow !high #work friday")).toMatchObject({
      title: "Pay rent friday",
      dueDate: "2026-11-27",
      priority: "high",
      listId: "l-work",
    });
  });

  it("keeps dismissed kinds in the title", () => {
    expect(parse("Read Monday Begins on Saturday", ["date"])).toMatchObject({
      title: "Read Monday Begins on Saturday",
      dueDate: null,
      tokens: [],
    });
    expect(parse("Fix leak tomorrow !high", ["priority"])).toMatchObject({
      title: "Fix leak !high",
      priority: null,
      dueDate: "2026-11-27",
    });
  });

  it("takes nothing when nothing would be left of the title", () => {
    expect(parse("tomorrow")).toMatchObject({ title: "tomorrow", dueDate: null, tokens: [] });
    expect(parse("  Call   mom   tomorrow ").title).toBe("Call mom");
  });

  it("ignores trailing punctuation when matching", () => {
    expect(parse("Call mom tomorrow, then dad")).toMatchObject({
      title: "Call mom then dad",
      dueDate: "2026-11-27",
    });
  });
});
