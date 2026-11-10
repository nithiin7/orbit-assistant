import type {
  DashboardDensity,
  DashboardWidget,
  DashboardWidgetId as WidgetId,
  DashboardWidgetSize as WidgetSize,
} from "@orbit/contracts";

/**
 * The dashboard layout: which widgets show, in what order, how wide, and how densely, and
 * whether amounts are hidden. The API saves it per user (`/api/v1/me/dashboard`); this browser
 * keeps a copy so the page shows the user's layout before the API answers. It only arranges the
 * page; each widget loads its own data.
 */

export type { DashboardWidget, WidgetId, WidgetSize };

export type Density = DashboardDensity;

/** How the dashboard is shown, saved with the layout. */
export type DashboardPreferences = {
  density: Density;
  /** Show money amounts as dots, for screens other people can see. */
  hideAmounts: boolean;
};

export const defaultPreferences: DashboardPreferences = {
  density: "comfortable",
  hideAmounts: false,
};

export const widgetIds = [
  "today",
  "quick_actions",
  "calendar",
  "tasks",
  "habits",
  "attention",
  "notes",
  "documents",
  "cash_flow",
  "budget",
  "upcoming_payments",
  "savings_goals",
  "net_worth",
  "reminders",
  "shopping",
  "watchlist",
  "workouts",
  "water",
  "nutrition",
  "weight",
  "fitness_goals",
  "workspace",
  "status",
  "modules",
] as const satisfies readonly WidgetId[];

export type WidgetGroup = "Today" | "Plan and track" | "Money" | "Health" | "Orbit";

export const widgetGroups: readonly WidgetGroup[] = [
  "Today",
  "Plan and track",
  "Money",
  "Health",
  "Orbit",
];

export type WidgetDefinition = {
  id: WidgetId;
  title: string;
  description: string;
  group: WidgetGroup;
  defaultSize: WidgetSize;
  /** On a new dashboard. Health and the most sensitive money widgets are opt-in. */
  defaultVisible: boolean;
};

/** Every widget the dashboard can show, in default order. */
export const widgetCatalog: readonly WidgetDefinition[] = [
  {
    id: "today",
    title: "Today",
    description: "A greeting, and what today holds across your modules.",
    group: "Today",
    defaultSize: "full",
    defaultVisible: true,
  },
  {
    id: "quick_actions",
    title: "Quick actions",
    description: "Add a task, note, event, reminder, or expense without leaving.",
    group: "Today",
    defaultSize: "full",
    defaultVisible: true,
  },
  {
    id: "calendar",
    title: "Agenda",
    description: "Today’s events and tasks, and what’s coming up.",
    group: "Today",
    defaultSize: "half",
    defaultVisible: true,
  },
  {
    id: "tasks",
    title: "Tasks",
    description: "Today, priorities, upcoming deadlines, and what you finished.",
    group: "Today",
    defaultSize: "half",
    defaultVisible: true,
  },
  {
    id: "habits",
    title: "Habits",
    description: "Today’s habits and routines, with streaks.",
    group: "Today",
    defaultSize: "half",
    defaultVisible: true,
  },
  {
    id: "attention",
    title: "Needs attention",
    description: "Overdue tasks, reminders due, expiring documents, and payments due.",
    group: "Today",
    defaultSize: "half",
    defaultVisible: true,
  },
  {
    id: "notes",
    title: "Notes",
    description: "Pinned, favorite, and recent notes, and today’s journal.",
    group: "Plan and track",
    defaultSize: "half",
    defaultVisible: true,
  },
  {
    id: "documents",
    title: "Documents",
    description: "Expiring and expired documents, favorites, and recently opened.",
    group: "Plan and track",
    defaultSize: "half",
    defaultVisible: true,
  },
  {
    id: "cash_flow",
    title: "This month",
    description: "Income, spending, and account balances this month.",
    group: "Money",
    defaultSize: "half",
    defaultVisible: true,
  },
  {
    id: "budget",
    title: "Budget",
    description: "How much of this month’s budget is spent.",
    group: "Money",
    defaultSize: "half",
    defaultVisible: true,
  },
  {
    id: "upcoming_payments",
    title: "Upcoming payments",
    description: "Overdue EMIs, bills, and renewals, and what is due in the next 30 days.",
    group: "Money",
    defaultSize: "half",
    defaultVisible: false,
  },
  {
    id: "savings_goals",
    title: "Savings goals",
    description: "Progress toward each active savings goal.",
    group: "Money",
    defaultSize: "half",
    defaultVisible: false,
  },
  {
    id: "net_worth",
    title: "Net worth",
    description: "What you own, what you owe, and the difference.",
    group: "Money",
    defaultSize: "half",
    defaultVisible: false,
  },
  {
    id: "reminders",
    title: "Reminders",
    description: "The next reminders due in this workspace.",
    group: "Plan and track",
    defaultSize: "half",
    defaultVisible: false,
  },
  {
    id: "shopping",
    title: "Shopping",
    description: "How much is left to buy on each list.",
    group: "Plan and track",
    defaultSize: "half",
    defaultVisible: false,
  },
  {
    id: "watchlist",
    title: "Watchlist",
    description: "What you’re watching, with one tap for the next episode, and what’s up next.",
    group: "Plan and track",
    defaultSize: "half",
    defaultVisible: false,
  },
  {
    id: "workouts",
    title: "Workouts",
    description: "Today’s scheduled workout, your last one, and this week’s count.",
    group: "Health",
    defaultSize: "half",
    defaultVisible: false,
  },
  {
    id: "water",
    title: "Water",
    description: "Today’s water against your target, with quick add.",
    group: "Health",
    defaultSize: "half",
    defaultVisible: false,
  },
  {
    id: "nutrition",
    title: "Nutrition",
    description: "Today’s calories and protein against your targets.",
    group: "Health",
    defaultSize: "half",
    defaultVisible: false,
  },
  {
    id: "weight",
    title: "Weight",
    description: "Your weight trend over recent measurements.",
    group: "Health",
    defaultSize: "half",
    defaultVisible: false,
  },
  {
    id: "fitness_goals",
    title: "Fitness goals",
    description: "Progress toward your active fitness goals.",
    group: "Health",
    defaultSize: "half",
    defaultVisible: false,
  },
  {
    id: "workspace",
    title: "Workspace",
    description: "The active workspace and who is signed in.",
    group: "Orbit",
    defaultSize: "half",
    defaultVisible: false,
  },
  {
    id: "status",
    title: "Orbit status",
    description: "What is built so far and what comes next.",
    group: "Orbit",
    defaultSize: "half",
    defaultVisible: false,
  },
  {
    id: "modules",
    title: "Planned modules",
    description: "Sections of Orbit that are not built yet.",
    group: "Orbit",
    defaultSize: "full",
    defaultVisible: false,
  },
];

export function findWidget(id: WidgetId): WidgetDefinition {
  const widget = widgetCatalog.find((definition) => definition.id === id);
  if (!widget) throw new Error(`Unknown dashboard widget: ${id}`);
  return widget;
}

export const defaultLayout: readonly DashboardWidget[] = widgetCatalog
  .filter((widget) => widget.defaultVisible)
  .map(({ id, defaultSize }) => ({ id, size: defaultSize }));

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

/** Read stored display preferences; anything missing or unreadable is the default. */
export function parsePreferences(raw: string | null): DashboardPreferences {
  if (raw === null) return { ...defaultPreferences };
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return { ...defaultPreferences };
  }
  if (typeof stored !== "object" || stored === null) return { ...defaultPreferences };
  const density = "density" in stored ? stored.density : undefined;
  const hideAmounts = "hideAmounts" in stored ? stored.hideAmounts : undefined;
  return {
    density: density === "compact" ? "compact" : "comfortable",
    hideAmounts: hideAmounts === true,
  };
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

export function readDashboardPreferences(userId: string): DashboardPreferences {
  try {
    return parsePreferences(localStorage.getItem(dashboardPreferenceKey(userId)));
  } catch {
    return { ...defaultPreferences };
  }
}

export function writeDashboardLayout(
  userId: string,
  layout: readonly DashboardWidget[],
  preferences: DashboardPreferences = defaultPreferences,
): void {
  try {
    localStorage.setItem(
      dashboardPreferenceKey(userId),
      JSON.stringify({ version: LAYOUT_VERSION, widgets: layout, ...preferences }),
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
