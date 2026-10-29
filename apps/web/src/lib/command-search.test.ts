import { describe, expect, it } from "vitest";

import { filterCommands } from "./command-search";

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
