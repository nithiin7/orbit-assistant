import { afterEach, describe, expect, it } from "vitest";

import {
  addWidget,
  dashboardPreferenceKey,
  defaultLayout,
  findWidget,
  hiddenWidgets,
  moveWidget,
  parseLayout,
  parsePreferences,
  readDashboardLayout,
  readDashboardPreferences,
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
    ).toEqual([{ id: "tasks", size: findWidget("tasks").defaultSize }]);
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
    const hidden = hiddenWidgets(next).map((widget) => widget.id);
    expect(hidden).toContain("tasks");
    expect(hidden).not.toContain("shopping");
    expect(hidden).toEqual(widgetIds.filter((id) => id !== "shopping"));
    // Opt-in widgets are hidden on a new dashboard: health data and the most sensitive money.
    expect(hiddenWidgets(defaultLayout).map((widget) => widget.id)).toEqual(
      widgetCatalog.filter((widget) => !widget.defaultVisible).map((widget) => widget.id),
    );
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

  it("starts new dashboards with today first and keeps health and net worth opt-in", () => {
    expect(defaultLayout.slice(0, 4).map((widget) => widget.id)).toEqual([
      "today",
      "quick_actions",
      "calendar",
      "tasks",
    ]);
    const shown = new Set(defaultLayout.map((widget) => widget.id));
    for (const id of ["workouts", "water", "nutrition", "weight", "fitness_goals", "net_worth"]) {
      expect(shown.has(id as never)).toBe(false);
    }
  });
});

describe("display preferences", () => {
  it("default to comfortable with amounts shown", () => {
    expect(parsePreferences(null)).toEqual({ density: "comfortable", hideAmounts: false });
    expect(parsePreferences("not json")).toEqual({ density: "comfortable", hideAmounts: false });
    expect(parsePreferences(JSON.stringify({ density: "tiny", hideAmounts: "yes" }))).toEqual({
      density: "comfortable",
      hideAmounts: false,
    });
  });

  it("are stored with the layout, per user", () => {
    writeDashboardLayout("user-a", [{ id: "tasks", size: "half" }], {
      density: "compact",
      hideAmounts: true,
    });

    expect(readDashboardPreferences("user-a")).toEqual({ density: "compact", hideAmounts: true });
    expect(readDashboardPreferences("user-b")).toEqual({
      density: "comfortable",
      hideAmounts: false,
    });
    expect(readDashboardLayout("user-a")).toEqual([{ id: "tasks", size: "half" }]);
  });
});
