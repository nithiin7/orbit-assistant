import type {
  DashboardWidget,
  DashboardWidgetId as WidgetId,
  DashboardWidgetSize as WidgetSize,
} from "@orbit/contracts";

/**
 * The dashboard layout: which widgets show, in what order, and how wide. The API saves it per
 * user (`/api/v1/me/dashboard`); this browser keeps a copy so the page shows the user's layout
 * before the API answers. It only arranges the page; each widget loads its own data.
 */

export type { DashboardWidget, WidgetId, WidgetSize };

export const widgetIds = [
  "workspace",
  "status",
  "tasks",
  "reminders",
  "shopping",
  "modules",
] as const satisfies readonly WidgetId[];

export type WidgetDefinition = {
  id: WidgetId;
  title: string;
  description: string;
  defaultSize: WidgetSize;
};

/** Every widget the dashboard can show, in default order. */
export const widgetCatalog: readonly WidgetDefinition[] = [
  {
    id: "workspace",
    title: "Workspace",
    description: "The active workspace and who is signed in.",
    defaultSize: "half",
  },
  {
    id: "status",
    title: "Orbit status",
    description: "What is built so far and what comes next.",
    defaultSize: "half",
  },
  {
    id: "tasks",
    title: "Tasks",
    description: "Task counts and the next open tasks.",
    defaultSize: "full",
  },
  {
    id: "reminders",
    title: "Reminders",
    description: "The next reminders due in this workspace.",
    defaultSize: "full",
  },
  {
    id: "shopping",
    title: "Shopping",
    description: "How much is left to buy on each list.",
    defaultSize: "full",
  },
  {
    id: "modules",
    title: "Planned modules",
    description: "Sections of Orbit that are not built yet.",
    defaultSize: "full",
  },
];

export function findWidget(id: WidgetId): WidgetDefinition {
  const widget = widgetCatalog.find((definition) => definition.id === id);
  if (!widget) throw new Error(`Unknown dashboard widget: ${id}`);
  return widget;
}

export const defaultLayout: readonly DashboardWidget[] = widgetCatalog.map(
  ({ id, defaultSize }) => ({ id, size: defaultSize }),
);

const LAYOUT_VERSION = 1;

export function dashboardPreferenceKey(userId: string): string {
  return `orbit:dashboard:${userId}`;
}

function isWidgetId(value: unknown): value is WidgetId {
  return widgetIds.some((id) => id === value);
}

/**
 * Read a stored layout. The value comes from browser storage, so it is validated: unknown or
 * repeated widgets are dropped, and a bad size falls back to the widget's default. Anything
 * unreadable gives the default layout. An empty list is kept, since the user removed everything.
 */
export function parseLayout(raw: string | null): DashboardWidget[] {
  if (raw === null) return [...defaultLayout];
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return [...defaultLayout];
  }
  if (typeof stored !== "object" || stored === null || !("widgets" in stored)) {
    return [...defaultLayout];
  }
  if (!("version" in stored) || stored.version !== LAYOUT_VERSION) return [...defaultLayout];
  const { widgets } = stored;
  if (!Array.isArray(widgets)) return [...defaultLayout];

  const layout: DashboardWidget[] = [];
  for (const entry of widgets as unknown[]) {
    if (typeof entry !== "object" || entry === null || !("id" in entry)) continue;
    const { id } = entry;
    if (!isWidgetId(id) || layout.some((widget) => widget.id === id)) continue;
    const size = "size" in entry ? entry.size : undefined;
    layout.push({
      id,
      size: size === "half" || size === "full" ? size : findWidget(id).defaultSize,
    });
  }
  return layout;
}

/** Whether this browser has a layout saved for the user, as opposed to the default. */
export function hasStoredDashboardLayout(userId: string): boolean {
  try {
    return localStorage.getItem(dashboardPreferenceKey(userId)) !== null;
  } catch {
    return false;
  }
}

export function readDashboardLayout(userId: string): DashboardWidget[] {
  try {
    return parseLayout(localStorage.getItem(dashboardPreferenceKey(userId)));
  } catch {
    return [...defaultLayout];
  }
}

export function writeDashboardLayout(userId: string, layout: readonly DashboardWidget[]): void {
  try {
    localStorage.setItem(
      dashboardPreferenceKey(userId),
      JSON.stringify({ version: LAYOUT_VERSION, widgets: layout }),
    );
  } catch {
    // Storage unavailable: the layout lasts for this page view only.
  }
}

export function clearDashboardLayout(userId: string): void {
  try {
    localStorage.removeItem(dashboardPreferenceKey(userId));
  } catch {
    // Storage unavailable: nothing was saved, so there is nothing to clear.
  }
}

/** Catalog widgets not on the dashboard, in catalog order. */
export function hiddenWidgets(layout: readonly DashboardWidget[]): WidgetDefinition[] {
  return widgetCatalog.filter(
    (definition) => !layout.some((widget) => widget.id === definition.id),
  );
}

/** Append a widget at its default size. Adding one already shown changes nothing. */
export function addWidget(layout: readonly DashboardWidget[], id: WidgetId): DashboardWidget[] {
  if (layout.some((widget) => widget.id === id)) return [...layout];
  return [...layout, { id, size: findWidget(id).defaultSize }];
}

export function removeWidget(layout: readonly DashboardWidget[], id: WidgetId): DashboardWidget[] {
  return layout.filter((widget) => widget.id !== id);
}

export function resizeWidget(
  layout: readonly DashboardWidget[],
  id: WidgetId,
  size: WidgetSize,
): DashboardWidget[] {
  return layout.map((widget) => (widget.id === id ? { ...widget, size } : widget));
}

/** Move a widget one place earlier (-1) or later (1). Moves past either end change nothing. */
export function moveWidget(
  layout: readonly DashboardWidget[],
  id: WidgetId,
  offset: -1 | 1,
): DashboardWidget[] {
  const from = layout.findIndex((widget) => widget.id === id);
  const to = from + offset;
  const moving = layout[from];
  const other = layout[to];
  if (from === -1 || !moving || !other) return [...layout];
  const next = [...layout];
  next[from] = other;
  next[to] = moving;
  return next;
}
