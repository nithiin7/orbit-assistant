import { afterEach, describe, expect, it } from "vitest";

import {
  addWidget,
  dashboardPreferenceKey,
  defaultLayout,
  hiddenWidgets,
  moveWidget,
  parseLayout,
  readDashboardLayout,
  removeWidget,
  resizeWidget,
  widgetCatalog,
  widgetIds,
  writeDashboardLayout,
} from "./dashboard";

const stored = (widgets: unknown, version: unknown = 1) => JSON.stringify({ version, widgets });

afterEach(() => {
  localStorage.clear();
});

describe("parseLayout", () => {
  it("uses the default layout when nothing usable is stored", () => {
    expect(parseLayout(null)).toEqual(defaultLayout);
    expect(parseLayout("not json")).toEqual(defaultLayout);
    expect(parseLayout(JSON.stringify(["tasks"]))).toEqual(defaultLayout);
    expect(parseLayout(stored("tasks"))).toEqual(defaultLayout);
    expect(parseLayout(stored([{ id: "tasks", size: "half" }], 99))).toEqual(defaultLayout);
  });

  it("keeps known widgets in their stored order and size", () => {
    expect(
      parseLayout(
        stored([
          { id: "shopping", size: "half" },
          { id: "tasks", size: "half" },
        ]),
      ),
    ).toEqual([
      { id: "shopping", size: "half" },
      { id: "tasks", size: "half" },
    ]);
  });

  it("drops unknown and repeated widgets, and repairs bad sizes", () => {
    expect(
      parseLayout(
        stored([
          { id: "weather", size: "full" },
          { id: "tasks", size: "huge" },
          { id: "tasks", size: "half" },
          "workspace",
          null,
        ]),
      ),
    ).toEqual([{ id: "tasks", size: "full" }]);
  });

  it("keeps an empty dashboard empty", () => {
    expect(parseLayout(stored([]))).toEqual([]);
  });
});

describe("stored layout", () => {
  it("round-trips per user", () => {
    writeDashboardLayout("user-a", [{ id: "tasks", size: "half" }]);

    expect(readDashboardLayout("user-a")).toEqual([{ id: "tasks", size: "half" }]);
    expect(readDashboardLayout("user-b")).toEqual(defaultLayout);
    expect(localStorage.getItem(dashboardPreferenceKey("user-a"))).not.toBeNull();
  });
});

describe("layout changes", () => {
  const layout = [
    { id: "tasks", size: "full" },
    { id: "shopping", size: "half" },
  ] as const;

  it("adds a widget at the end, at its default size, once", () => {
    expect(addWidget(layout, "workspace")).toEqual([...layout, { id: "workspace", size: "half" }]);
    expect(addWidget(layout, "tasks")).toEqual(layout);
  });

  it("removes a widget and lists it as hidden", () => {
    const next = removeWidget(layout, "tasks");

    expect(next).toEqual([{ id: "shopping", size: "half" }]);
    expect(hiddenWidgets(next).map((widget) => widget.id)).toEqual([
      "workspace",
      "status",
      "tasks",
      "modules",
    ]);
    expect(hiddenWidgets(defaultLayout)).toEqual([]);
    expect(hiddenWidgets([])).toEqual(widgetCatalog);
  });

  it("resizes only the chosen widget", () => {
    expect(resizeWidget(layout, "tasks", "half")).toEqual([
      { id: "tasks", size: "half" },
      { id: "shopping", size: "half" },
    ]);
  });

  it("moves a widget one place, and not past either end", () => {
    expect(moveWidget(layout, "shopping", -1).map((widget) => widget.id)).toEqual([
      "shopping",
      "tasks",
    ]);
    expect(moveWidget(layout, "tasks", 1).map((widget) => widget.id)).toEqual([
      "shopping",
      "tasks",
    ]);
    expect(moveWidget(layout, "tasks", -1)).toEqual(layout);
    expect(moveWidget(layout, "shopping", 1)).toEqual(layout);
    expect(moveWidget(layout, "modules", 1)).toEqual(layout);
  });
});

describe("widgetCatalog", () => {
  it("describes every widget the API accepts, once", () => {
    expect(widgetCatalog.map((widget) => widget.id)).toEqual(widgetIds);
  });
});
