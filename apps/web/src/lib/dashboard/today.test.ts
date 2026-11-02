import type { TodayOverview } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import { attentionItems, firstName, formatDayHeading, greeting, hourIn } from "./today";

function overview(changes: Partial<TodayOverview> = {}): TodayOverview {
  return {
    date: "2030-06-11",
    timezone: "UTC",
    generated_at: "2030-06-11T08:00:00Z",
    tasks: null,
    events: null,
    reminders: null,
    habits: null,
    documents: null,
    payments: null,
    unavailable: [],
    ...changes,
  };
}

const task = {
  id: "t1",
  workspace_id: "w1",
  title: "File taxes",
  description: "",
  status: "open" as const,
  priority: "high" as const,
  due_date: "2030-06-08",
  completed_at: null,
  scheduled_start: null,
  scheduled_end: null,
  created_at: "2030-06-01T00:00:00Z",
  updated_at: "2030-06-01T00:00:00Z",
};

describe("greeting", () => {
  it("follows the hour", () => {
    expect(greeting(6)).toBe("Good morning");
    expect(greeting(11)).toBe("Good morning");
    expect(greeting(12)).toBe("Good afternoon");
    expect(greeting(18)).toBe("Good evening");
    expect(greeting(2)).toBe("Good evening");
  });

  it("reads the hour on the viewer's clock, not the browser's", () => {
    const instant = new Date("2030-06-10T22:30:00Z");
    expect(hourIn("Asia/Tokyo", instant)).toBe(7);
    expect(hourIn("America/New_York", instant)).toBe(18);
  });

  it("uses the first name", () => {
    expect(firstName("Ada Lovelace")).toBe("Ada");
    expect(firstName("  ")).toBe("");
  });

  it("formats the day as a heading", () => {
    expect(formatDayHeading("2030-06-11")).toMatch(/Tuesday/);
    expect(formatDayHeading("2030-06-11")).toMatch(/11/);
  });
});

describe("attentionItems", () => {
  it("is empty when nothing needs attention or nothing loaded", () => {
    expect(attentionItems(overview(), "UTC")).toEqual([]);
  });

  it("lists urgent items first, each linking to its module", () => {
    const items = attentionItems(
      overview({
        tasks: { open: 1, overdue: 1, due_today: 0, overdue_items: [task], due_today_items: [] },
        documents: {
          expired: 1,
          expiring: 1,
          items: [
            { id: "d1", title: "Visa", expiry_date: "2030-06-01" },
            { id: "d2", title: "Passport", expiry_date: "2030-06-12" },
          ],
        },
        payments: {
          overdue: 0,
          due_soon: 1,
          items: [
            {
              kind: "bill",
              commitment_id: "c1",
              name: "Internet",
              due_date: "2030-06-11",
              status: "due",
            },
          ],
        },
        reminders: {
          pending: 1,
          items: [
            {
              id: "r1",
              title: "Call mum",
              next_occurrence_at: "2030-06-11T07:00:00Z",
              task_id: null,
            },
          ],
        },
      }),
      "UTC",
    );

    expect(items.map((item) => [item.title, item.detail, item.urgent])).toEqual([
      ["File taxes", "Overdue by 3 days", true],
      ["Visa", expect.stringMatching(/^Expired /), true],
      ["Call mum", "Due now", true],
      ["Passport", "Expires tomorrow", false],
      ["Internet", "Due today", false],
    ]);
    expect(items[0]?.href).toBe("/tasks?task=t1");
    expect(items.find((item) => item.kind === "payment_due")?.href).toBe("/finance?view=upcoming");
  });
});
