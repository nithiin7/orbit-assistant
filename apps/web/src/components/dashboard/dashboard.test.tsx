import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuickCaptureProvider } from "@/components/notes/quick-capture";
import { QuickActionsProvider } from "@/components/quick-actions/quick-actions";
import {
  dashboardPreferenceKey,
  defaultLayout,
  readDashboardLayout,
  writeDashboardLayout,
} from "@/lib/dashboard";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { Dashboard } from "./dashboard";

/** The dashboard as the app shell renders it, with quick capture and quick actions. */
const renderDashboard = () =>
  renderSignedIn(
    <QuickCaptureProvider>
      <QuickActionsProvider>
        <Dashboard />
      </QuickActionsProvider>
    </QuickCaptureProvider>,
  );

const PREFERENCES = { density: "comfortable", hide_amounts: false } as const;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

const WORKSPACE = `/api/v1/workspaces/${personal.id}`;
const DASHBOARD = "/api/v1/me/dashboard";
const UPDATED_AT = "2026-10-29T12:00:00Z";
/** Echo a saved layout back, as the API does. */
const saved = ({ body }: MockRequest) =>
  Response.json({ ...(body as object), updated_at: UPDATED_AT });

const routes = {
  [`GET ${DASHBOARD}`]: status(204),
  [`PUT ${DASHBOARD}`]: saved,
  [`DELETE ${DASHBOARD}`]: status(204),
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
  "GET /api/v1/health/database": json({ status: "ok", storage_mode: "local" }),
  [`GET ${WORKSPACE}`]: json(personal),
  [`GET ${WORKSPACE}/tasks/summary`]: json({ open: 0, completed: 0, overdue: 0, due_today: 0 }),
  [`GET ${WORKSPACE}/tasks`]: json({ tasks: [], total: 0 }),
  [`GET ${WORKSPACE}/shopping/lists`]: json({ lists: [] }),
  [`GET ${WORKSPACE}/reminders/upcoming`]: json({ reminders: [] }),
  [`GET ${WORKSPACE}/calendar/range`]: json({
    occurrences: [],
    scheduled_tasks: [],
    due_tasks: [],
  }),
  [`GET ${WORKSPACE}/calendar/agenda`]: json({ items: [], next_cursor: null }),
  [`GET ${WORKSPACE}/calendar/categories`]: json({ categories: [] }),
  [`GET ${WORKSPACE}/finance/accounts`]: json({
    accounts: [
      {
        id: "acc-1",
        workspace_id: personal.id,
        name: "Wallet",
        type: "cash",
        currency: "INR",
        opening_balance: 0,
        balance: 500_000,
        archived: false,
        notes: "",
        created_at: "2026-10-01T09:00:00Z",
        updated_at: "2026-10-01T09:00:00Z",
      },
    ],
    totals: [{ currency: "INR", assets: 500_000, liabilities: 0, net: 500_000 }],
  }),
  [`GET ${WORKSPACE}/finance/summary`]: json({
    month: "2026-10",
    currency: "INR",
    income: 1_234_500,
    expenses: 0,
    refunds: 0,
    net_expenses: 0,
    net: 1_234_500,
    transfers_in: 0,
    transfers_out: 0,
  }),
  [`GET ${WORKSPACE}/dashboard/today`]: json(overview()),
  [`GET ${WORKSPACE}/habits/today`]: json({
    day: "2026-10-29",
    habits: [],
    week: [],
    upcoming: [],
  }),
  [`GET ${WORKSPACE}/routines`]: json({ routines: [] }),
  [`GET ${WORKSPACE}/notes`]: json({ notes: [], total: 0 }),
  [`GET ${WORKSPACE}/documents/overview`]: json({
    counts: {
      all: 0,
      favorites: 0,
      unfiled: 0,
      unclassified: 0,
      without_file: 0,
      expiring_7: 0,
      expiring_30: 0,
      expiring_90: 0,
      expired: 0,
      renewals: 0,
      archived: 0,
      trashed: 0,
      total_bytes: 0,
    },
    recently_added: [],
    recently_updated: [],
    favorites: [],
    expiring: [],
    expired: [],
    categories: [],
  }),
  [`GET ${WORKSPACE}/finance/payments`]: json({
    today: "2026-10-29",
    date_from: "2026-10-29",
    date_to: "2026-11-28",
    payments: [],
  }),
  [`GET ${WORKSPACE}/finance/budgets/overview`]: json({
    month: "2026-10",
    currency: "INR",
    total: null,
    basis: null,
    spent: 0,
    remaining: null,
    utilization_percent: null,
    status: null,
    budgets_counted: 0,
    budgets_within: 0,
    unbudgeted: null,
    categories: [],
    budgets: [],
  }),
  [`GET ${WORKSPACE}/finance/net-worth`]: json({
    currency: "INR",
    currencies: [],
    as_of: "2026-10-29",
    assets: 0,
    liabilities: 0,
    net_worth: 0,
    groups: [],
    items: [],
    quality: { estimated: 0, manual: 0, stale: 0, missing: 0 },
    changes: [],
  }),
};

function overview(changes: Record<string, unknown> = {}) {
  return {
    date: "2026-10-29",
    timezone: "UTC",
    generated_at: "2026-10-29T08:00:00Z",
    tasks: { open: 2, overdue: 1, due_today: 1, overdue_items: [], due_today_items: [] },
    events: { today: [], next: null },
    reminders: { pending: 0, items: [] },
    habits: { remaining: 2, done: 1, total: 3 },
    documents: { expired: 0, expiring: 0, items: [] },
    payments: { overdue: 0, due_soon: 0, items: [] },
    unavailable: [],
    ...changes,
  };
}

/** Bodies of the layouts the dashboard saved to the account, oldest first. */
const savedLayouts = (api: ReturnType<typeof mockApi>) =>
  api.mock.calls
    .filter(([input, init]) => init?.method === "PUT" && String(input).endsWith(DASHBOARD))
    .map(([, init]) => JSON.parse(String(init?.body)) as unknown);

/** Widget names in page order, read from the customize-mode groups. */
const widgetOrder = () =>
  screen
    .getAllByRole("group", { name: / widget$/ })
    .map((group) => group.getAttribute("aria-label"));

async function customize() {
  const user = userEvent.setup();
  await renderDashboard();
  await user.click(screen.getByRole("button", { name: "Customize" }));
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Dashboard", () => {
  it("starts with today, actions, and the main modules, keeping health opt-in", async () => {
    mockApi(routes);
    await renderDashboard();

    expect(
      screen.getByRole("heading", { name: /^Good (morning|afternoon|evening), Ada$/ }),
    ).toBeInTheDocument();
    for (const name of ["Today’s agenda", "Tasks", "Habits", "Needs attention", "Notes"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    for (const name of ["Documents", "This month", "Budget"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("group", { name: "Create" })).toBeInTheDocument();
    for (const name of ["Workouts", "Water", "Weight", "Net worth", "Shopping"]) {
      expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it("summarizes today from the overview and links to each module", async () => {
    mockApi(routes);
    await renderDashboard();

    const tasks = await screen.findByRole("link", { name: /Tasks due/ });
    expect(tasks).toHaveTextContent("1 overdue");
    expect(tasks).toHaveAttribute("href", "/tasks");
    expect(screen.getByRole("link", { name: /Habits done/ })).toHaveTextContent("1/3");
    expect(screen.getByRole("link", { name: /Events today/ })).toHaveAttribute(
      "href",
      "/calendar?view=day&date=2026-10-29",
    );
  });

  it("keeps the rest of the dashboard when one module fails", async () => {
    mockApi({
      ...routes,
      [`GET ${WORKSPACE}/documents/overview`]: status(500),
      [`GET ${WORKSPACE}/dashboard/today`]: json(
        overview({ habits: null, unavailable: ["habits"] }),
      ),
    });
    await renderDashboard();

    const documents = screen.getByRole("region", { name: "Documents" });
    expect(
      await within(documents).findByRole("button", { name: "Try again" }, { timeout: 4000 }),
    ).toBeInTheDocument();
    // Other widgets still load.
    expect(await screen.findByText("Nothing due today. Enjoy the space.")).toBeInTheDocument();
    const habits = await screen.findByRole("link", { name: /Habits done/ });
    expect(habits).toHaveTextContent("Couldn’t load");
    expect(screen.getByText(/Some of today couldn’t load just now/)).toBeInTheDocument();
  });

  it("removes a widget, then adds it back at the end", async () => {
    mockApi(routes);
    const user = await customize();

    await user.click(screen.getByRole("button", { name: "Remove Notes" }));

    expect(screen.queryByRole("heading", { name: "Notes" })).not.toBeInTheDocument();
    const add = screen.getByRole("button", { name: "Add Notes" });
    expect(add).toHaveFocus();
    expect(readDashboardLayout(ada.id).map((widget) => widget.id)).not.toContain("notes");

    await user.click(add);

    expect(screen.getByRole("heading", { name: "Notes" })).toBeInTheDocument();
    expect(widgetOrder().at(-1)).toBe("Notes widget");
    expect(screen.getByRole("button", { name: "Remove Notes" })).toHaveFocus();
  });

  it("adds an opt-in health widget from its group", async () => {
    mockApi({
      ...routes,
      // Health data isn't needed to arrange the widget; it shows its own error.
      [`GET ${WORKSPACE}/fitness/overview`]: status(500),
      [`GET ${WORKSPACE}/fitness/profile`]: status(500),
    });
    const user = await customize();

    const health = screen.getByRole("heading", { name: "Health", level: 4 });
    expect(health.nextElementSibling).toHaveTextContent("Water");
    await user.click(screen.getByRole("button", { name: "Add Water" }));

    expect(readDashboardLayout(ada.id).at(-1)).toEqual({ id: "water", size: "half" });
  });

  it("resizes a widget and remembers it for the user", async () => {
    mockApi(routes);
    const user = await customize();
    const width = screen.getByRole("group", { name: "Tasks width" });

    await user.click(within(width).getByRole("button", { name: "Wide" }));

    expect(within(width).getByRole("button", { name: "Wide" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(width).getByRole("button", { name: "Narrow" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(readDashboardLayout(ada.id)).toContainEqual({ id: "tasks", size: "full" });
    expect(screen.getByText("Tasks is now wide.")).toBeInTheDocument();
  });

  it("reorders widgets and keeps focus on the control", async () => {
    mockApi(routes);
    const user = await customize();

    await user.click(screen.getByRole("button", { name: "Move Tasks earlier" }));

    expect(widgetOrder().slice(0, 4)).toEqual([
      "Today widget",
      "Quick actions widget",
      "Tasks widget",
      "Agenda widget",
    ]);
    expect(screen.getByRole("button", { name: "Move Tasks earlier" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Move Tasks earlier" }));
    await user.click(screen.getByRole("button", { name: "Move Tasks earlier" }));

    // Tasks is now first, so "earlier" is disabled and focus moves to "later".
    expect(screen.getByRole("button", { name: "Move Tasks earlier" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Tasks later" })).toHaveFocus();
  });

  it("restores a saved layout and loads only the widgets on it", async () => {
    writeDashboardLayout(ada.id, [{ id: "tasks", size: "half" }]);
    const api = mockApi(routes);
    await renderDashboard();

    expect(await screen.findByText("Nothing due today. Enjoy the space.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Notes" })).not.toBeInTheDocument();
    const paths = api.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths).not.toContain(`${WORKSPACE}/notes`);
    expect(paths).not.toContain(`${WORKSPACE}/dashboard/today`);
  });

  it("shows an empty state when every widget is removed, and can reset", async () => {
    writeDashboardLayout(ada.id, []);
    mockApi(routes);
    const user = userEvent.setup();
    await renderDashboard();

    expect(screen.getByRole("heading", { name: "Your dashboard is empty" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Customize" }));
    await user.click(screen.getByRole("button", { name: "Reset to default" }));

    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(localStorage.getItem(dashboardPreferenceKey(ada.id))).toBeNull();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
  });
});

describe("Dashboard account sync", () => {
  it("shows the layout saved to the account over this browser's copy", async () => {
    writeDashboardLayout(ada.id, [{ id: "shopping", size: "full" }]);
    mockApi({
      ...routes,
      [`GET ${DASHBOARD}`]: json({
        widgets: [{ id: "tasks", size: "half" }],
        ...PREFERENCES,
        updated_at: UPDATED_AT,
      }),
    });
    await renderDashboard();

    expect(await screen.findByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Shopping" })).not.toBeInTheDocument();
    expect(readDashboardLayout(ada.id)).toEqual([{ id: "tasks", size: "half" }]);
  });

  it("uploads a layout saved in this browser when the account has none", async () => {
    writeDashboardLayout(ada.id, [{ id: "shopping", size: "half" }]);
    const api = mockApi(routes);
    await renderDashboard();

    await waitFor(() =>
      expect(savedLayouts(api)).toEqual([
        { widgets: [{ id: "shopping", size: "half" }], ...PREFERENCES },
      ]),
    );
  });

  it("keeps the default dashboard without saving when nothing was arranged", async () => {
    const api = mockApi(routes);
    await renderDashboard();

    await waitFor(() =>
      expect(api.mock.calls.some(([input]) => String(input).endsWith(DASHBOARD))).toBe(true),
    );
    expect(savedLayouts(api)).toEqual([]);
  });

  it("saves each change to the account, and resets it there", async () => {
    const api = mockApi(routes);
    const user = await customize();

    await user.click(screen.getByRole("button", { name: "Remove Notes" }));
    await user.click(screen.getByRole("button", { name: "Remove Documents" }));

    await waitFor(() => expect(savedLayouts(api)).toHaveLength(2));
    expect(savedLayouts(api).at(-1)).toEqual({
      widgets: defaultLayout.filter((widget) => !["notes", "documents"].includes(widget.id)),
      ...PREFERENCES,
    });

    await user.click(screen.getByRole("button", { name: "Reset to default" }));

    await waitFor(() =>
      expect(
        api.mock.calls.some(
          ([input, init]) => init?.method === "DELETE" && String(input).endsWith(DASHBOARD),
        ),
      ).toBe(true),
    );
  });

  it("reports a failed save and saves again on retry", async () => {
    let fail = true;
    const api = mockApi({
      ...routes,
      [`PUT ${DASHBOARD}`]: (request) =>
        fail ? new Response(null, { status: 503 }) : saved(request),
    });
    const user = await customize();

    await user.click(screen.getByRole("button", { name: "Remove Notes" }));

    const alert = await screen.findByText(/database is unavailable/);
    // The change still applies in this browser.
    expect(screen.queryByRole("heading", { name: "Notes" })).not.toBeInTheDocument();
    expect(readDashboardLayout(ada.id).map((widget) => widget.id)).not.toContain("notes");

    fail = false;
    const banner = alert.closest("[role=alert]");
    if (!(banner instanceof HTMLElement)) throw new Error("The save error is not an alert.");
    await user.click(within(banner).getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(screen.queryByText(/database is unavailable/)).not.toBeInTheDocument(),
    );
    expect(savedLayouts(api).at(-1)).toEqual({
      widgets: readDashboardLayout(ada.id),
      ...PREFERENCES,
    });
  });

  it("sends changes in order, skipping ones overtaken while a save is in flight", async () => {
    let releaseFirst: () => void = () => {};
    let puts = 0;
    const api = mockApi({
      ...routes,
      [`PUT ${DASHBOARD}`]: (request) => {
        puts += 1;
        if (puts > 1) return saved(request);
        return new Promise((resolve) => {
          releaseFirst = () => resolve(saved(request));
        });
      },
    });
    const user = await customize();

    await user.click(screen.getByRole("button", { name: "Remove Notes" }));
    await waitFor(() => expect(puts).toBe(1));
    await user.click(screen.getByRole("button", { name: "Remove Documents" }));
    await user.click(screen.getByRole("button", { name: "Remove Budget" }));
    releaseFirst();

    await waitFor(() => expect(savedLayouts(api)).toHaveLength(2));
    expect(savedLayouts(api)[0]).toEqual({
      widgets: defaultLayout.filter((widget) => widget.id !== "notes"),
      ...PREFERENCES,
    });
    expect(savedLayouts(api)[1]).toEqual({ widgets: readDashboardLayout(ada.id), ...PREFERENCES });
    expect(readDashboardLayout(ada.id).map((widget) => widget.id)).toEqual(
      defaultLayout
        .map((widget) => widget.id)
        .filter((id) => !["notes", "documents", "budget"].includes(id)),
    );
  });
});

describe("Dashboard display", () => {
  it("hides money amounts and saves the choice to the account", async () => {
    const api = mockApi(routes);
    const user = await customize();
    const cashFlow = screen.getByRole("region", { name: "This month" });
    expect((await within(cashFlow).findAllByText(/12,345/)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("checkbox", { name: "Hide money amounts" }));

    expect(within(cashFlow).queryByText(/12,345/)).not.toBeInTheDocument();
    expect(within(cashFlow).getAllByText("••••").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(savedLayouts(api).at(-1)).toEqual({
        widgets: [...defaultLayout],
        density: "comfortable",
        hide_amounts: true,
      }),
    );
  });

  it("switches to the compact density and remembers it", async () => {
    const api = mockApi(routes);
    const user = await customize();
    const density = screen.getByRole("group", { name: "Density" });

    await user.click(within(density).getByRole("button", { name: "Compact" }));

    expect(within(density).getByRole("button", { name: "Compact" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.querySelector("[data-density]")).toHaveAttribute("data-density", "compact");
    await waitFor(() =>
      expect(savedLayouts(api).at(-1)).toMatchObject({ density: "compact", hide_amounts: false }),
    );
  });

  it("shows the account's display preferences", async () => {
    mockApi({
      ...routes,
      [`GET ${DASHBOARD}`]: json({
        widgets: [{ id: "cash_flow", size: "half" }],
        density: "compact",
        hide_amounts: true,
        updated_at: UPDATED_AT,
      }),
    });
    await renderDashboard();

    const cashFlow = await screen.findByRole("region", { name: "This month" });
    expect((await within(cashFlow).findAllByText("••••")).length).toBeGreaterThan(0);
    expect(document.querySelector("[data-density]")).toHaveAttribute("data-density", "compact");
  });
});
