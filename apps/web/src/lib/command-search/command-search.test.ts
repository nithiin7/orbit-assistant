import { describe, expect, it } from "vitest";

import { describeSearchHit, filterCommands, searchHitHref } from "./command-search";

const items = [
  { label: "Go to Dashboard", keywords: ["home", "overview"] },
  { label: "Go to Tasks", keywords: ["todo"] },
  { label: "Tasks archive" },
  { label: "Use dark theme", keywords: ["appearance"] },
];

describe("filterCommands", () => {
  it("returns every item for an empty or blank query", () => {
    expect(filterCommands(items, "")).toEqual(items);
    expect(filterCommands(items, "   ")).toEqual(items);
  });

  it("matches labels and keywords case-insensitively", () => {
    expect(filterCommands(items, "HOME").map((item) => item.label)).toEqual(["Go to Dashboard"]);
    expect(filterCommands(items, "appearance").map((item) => item.label)).toEqual([
      "Use dark theme",
    ]);
  });

  it("requires every term to match", () => {
    expect(filterCommands(items, "go tasks").map((item) => item.label)).toEqual(["Go to Tasks"]);
    expect(filterCommands(items, "go nowhere")).toEqual([]);
  });

  it("ranks label prefix matches first", () => {
    expect(filterCommands(items, "tasks").map((item) => item.label)).toEqual([
      "Tasks archive",
      "Go to Tasks",
    ]);
  });
});

describe("search hits", () => {
  const hit = {
    id: "id-1",
    title: "Garden",
    detail: "",
    status: "open",
    day: "2030-05-01",
    starts_at: null,
    all_day: false,
  };

  it("open the record in its own module", () => {
    expect(searchHitHref("tasks", hit)).toBe("/tasks?task=id-1");
    expect(searchHitHref("notes", hit)).toBe("/notes?note=id-1");
    expect(searchHitHref("events", hit)).toBe("/calendar?view=day&date=2030-05-01");
    expect(searchHitHref("documents", hit)).toBe("/documents?document=id-1");
    expect(searchHitHref("habits", hit)).toBe("/habits?habit=id-1");
    expect(searchHitHref("transactions", hit)).toBe("/finance?view=transactions");
  });

  it("describe hits without amounts", () => {
    expect(describeSearchHit("tasks", hit)).toMatch(/^Task · due /);
    expect(describeSearchHit("tasks", { ...hit, status: "completed" })).toBe("Completed task");
    expect(describeSearchHit("events", { ...hit, detail: "Hall" })).toMatch(/ · Hall$/);
    expect(describeSearchHit("transactions", { ...hit, status: "expense" })).toMatch(/^Expense · /);
    expect(describeSearchHit("habits", { ...hit, status: "paused" })).toBe("Habit · paused");
  });
});
