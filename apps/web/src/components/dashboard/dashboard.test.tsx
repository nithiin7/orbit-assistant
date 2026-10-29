import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dashboardPreferenceKey, readDashboardLayout, writeDashboardLayout } from "@/lib/dashboard";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { Dashboard } from "./dashboard";

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
};

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
  await renderSignedIn(<Dashboard />);
  await user.click(screen.getByRole("button", { name: "Customize" }));
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Dashboard", () => {
  it("shows every widget by default, without editing controls", async () => {
    mockApi(routes);
    await renderSignedIn(<Dashboard />);

    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shopping" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Planned modules" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Orbit is in early development" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it("removes a widget, then adds it back at the end", async () => {
    mockApi(routes);
    const user = await customize();

    await user.click(screen.getByRole("button", { name: "Remove Shopping" }));

    expect(screen.queryByRole("heading", { name: "Shopping" })).not.toBeInTheDocument();
    const add = screen.getByRole("button", { name: "Add Shopping" });
    expect(add).toHaveFocus();
    expect(readDashboardLayout(ada.id).map((widget) => widget.id)).not.toContain("shopping");

    await user.click(add);

    expect(screen.getByRole("heading", { name: "Shopping" })).toBeInTheDocument();
    expect(widgetOrder().at(-1)).toBe("Shopping widget");
    expect(screen.getByRole("button", { name: "Remove Shopping" })).toHaveFocus();
    expect(screen.getByText("Every widget is on your dashboard.")).toBeInTheDocument();
  });

  it("resizes a widget and remembers it for the user", async () => {
    mockApi(routes);
    const user = await customize();
    const width = screen.getByRole("group", { name: "Tasks width" });

    await user.click(within(width).getByRole("button", { name: "Half" }));

    expect(within(width).getByRole("button", { name: "Half" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(width).getByRole("button", { name: "Full" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(readDashboardLayout(ada.id)).toContainEqual({ id: "tasks", size: "half" });
    expect(screen.getByText("Tasks set to half width.")).toBeInTheDocument();
  });

  it("reorders widgets and keeps focus on the control", async () => {
    mockApi(routes);
    const user = await customize();

    await user.click(screen.getByRole("button", { name: "Move Tasks earlier" }));

    expect(widgetOrder().slice(0, 3)).toEqual([
      "Workspace widget",
      "Tasks widget",
      "Orbit status widget",
    ]);
    expect(screen.getByRole("button", { name: "Move Tasks earlier" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Move Tasks earlier" }));

    // Tasks is now first, so "earlier" is disabled and focus moves to "later".
    expect(screen.getByRole("button", { name: "Move Tasks earlier" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Tasks later" })).toHaveFocus();
  });

  it("restores a saved layout and loads only the widgets on it", async () => {
    writeDashboardLayout(ada.id, [{ id: "tasks", size: "half" }]);
    const api = mockApi(routes);
    await renderSignedIn(<Dashboard />);

    expect(await screen.findByText(/No tasks in this workspace yet/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Shopping" })).not.toBeInTheDocument();
    const paths = api.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths).not.toContain(`${WORKSPACE}/shopping/lists`);
  });

  it("shows an empty state when every widget is removed, and can reset", async () => {
    writeDashboardLayout(ada.id, []);
    mockApi(routes);
    const user = userEvent.setup();
    await renderSignedIn(<Dashboard />);

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
        updated_at: UPDATED_AT,
      }),
    });
    await renderSignedIn(<Dashboard />);

    expect(await screen.findByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Shopping" })).not.toBeInTheDocument();
    expect(readDashboardLayout(ada.id)).toEqual([{ id: "tasks", size: "half" }]);
  });

  it("uploads a layout saved in this browser when the account has none", async () => {
    writeDashboardLayout(ada.id, [{ id: "shopping", size: "half" }]);
    const api = mockApi(routes);
    await renderSignedIn(<Dashboard />);

    await waitFor(() =>
      expect(savedLayouts(api)).toEqual([{ widgets: [{ id: "shopping", size: "half" }] }]),
    );
  });

  it("keeps the default dashboard without saving when nothing was arranged", async () => {
    const api = mockApi(routes);
    await renderSignedIn(<Dashboard />);

    await waitFor(() =>
      expect(api.mock.calls.some(([input]) => String(input).endsWith(DASHBOARD))).toBe(true),
    );
    expect(savedLayouts(api)).toEqual([]);
  });

  it("saves each change to the account, and resets it there", async () => {
    const api = mockApi(routes);
    const user = await customize();

    await user.click(screen.getByRole("button", { name: "Remove Shopping" }));
    await user.click(screen.getByRole("button", { name: "Remove Planned modules" }));

    await waitFor(() => expect(savedLayouts(api)).toHaveLength(2));
    expect(savedLayouts(api).at(-1)).toEqual({
      widgets: [
        { id: "workspace", size: "half" },
        { id: "status", size: "half" },
        { id: "tasks", size: "full" },
      ],
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

    await user.click(screen.getByRole("button", { name: "Remove Shopping" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/database is unavailable/);
    // The change still applies in this browser.
    expect(screen.queryByRole("heading", { name: "Shopping" })).not.toBeInTheDocument();
    expect(readDashboardLayout(ada.id).map((widget) => widget.id)).not.toContain("shopping");

    fail = false;
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(savedLayouts(api).at(-1)).toEqual({
      widgets: readDashboardLayout(ada.id),
    });
  });
});
