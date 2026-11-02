import type { Habit, HabitProgress, Task } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WaterWidget } from "@/components/fitness/fitness-widgets";
import { HabitsWidget } from "@/components/habits/habits-widget";
import { QuickCaptureProvider } from "@/components/notes/quick-capture";
import { QuickActionsProvider } from "@/components/quick-actions/quick-actions";
import { TaskWidget } from "@/components/tasks/task-widget";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { AttentionWidget } from "./attention-widget";
import { QuickActionsWidget } from "./quick-actions-widget";

const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/",
}));

const WS = `/api/v1/workspaces/${personal.id}`;

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

const today = new Date().toISOString().slice(0, 10);

function task(overrides: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    workspace_id: personal.id,
    description: "",
    status: "open",
    priority: "none",
    due_date: today,
    completed_at: null,
    scheduled_start: null,
    scheduled_end: null,
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

const withProviders = (ui: ReactNode) =>
  renderSignedIn(
    <QuickCaptureProvider>
      <QuickActionsProvider>{ui}</QuickActionsProvider>
    </QuickCaptureProvider>,
  );

/** The bodies sent to `method path`, oldest first. */
function sent(api: ReturnType<typeof mockApi>, method: string, path: string): unknown[] {
  return api.mock.calls
    .filter(([input, init]) => (init?.method ?? "GET") === method && String(input).includes(path))
    .map(([, init]) => (typeof init?.body === "string" ? JSON.parse(init.body) : undefined));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  push.mockReset();
});

describe("TaskWidget", () => {
  const rent = task({ id: "t-rent", title: "Pay rent", priority: "high" });

  it("lists today's tasks and completes one through the Tasks API", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      [`GET ${WS}/tasks`]: json({ tasks: [rent], total: 1 }),
      [`GET ${WS}/tasks/summary`]: json({ open: 1, completed: 0, overdue: 0, due_today: 1 }),
      [`POST ${WS}/tasks/t-rent/complete`]: json({
        ...rent,
        status: "completed",
        completed_at: "2026-11-02T10:00:00Z",
      }),
    });
    await renderSignedIn(<TaskWidget />);

    const checkbox = await screen.findByRole("checkbox", { name: "Complete “Pay rent”" });
    expect(screen.getByRole("link", { name: "Pay rent" })).toHaveAttribute(
      "href",
      "/tasks?task=t-rent",
    );
    const list = sent(api, "GET", `${WS}/tasks?`);
    expect(list.length).toBeGreaterThan(0);
    const firstList = api.mock.calls.find(([input]) => String(input).includes(`${WS}/tasks?`));
    expect(String(firstList?.[0])).toContain(`due_to=${today}`);

    await user.click(checkbox);

    expect(await screen.findByRole("checkbox", { name: "Reopen “Pay rent”" })).toBeChecked();
    expect(sent(api, "POST", "/tasks/t-rent/complete")).toHaveLength(1);
  });

  it("changes a task's priority", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      [`GET ${WS}/tasks`]: json({ tasks: [rent], total: 1 }),
      [`GET ${WS}/tasks/summary`]: json({ open: 1, completed: 0, overdue: 0, due_today: 1 }),
      [`PATCH ${WS}/tasks/t-rent`]: ({ body }: MockRequest) =>
        Response.json({ ...rent, ...(body as object) }),
    });
    await renderSignedIn(<TaskWidget />);

    await user.click(await screen.findByRole("button", { name: "Priority of “Pay rent”" }));
    await user.click(screen.getByRole("menuitemradio", { name: /Low/ }));

    await waitFor(() => expect(sent(api, "PATCH", "/tasks/t-rent")).toEqual([{ priority: "low" }]));
  });

  it("adds a task due today from the Today view", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      [`GET ${WS}/tasks`]: json({ tasks: [], total: 0 }),
      [`GET ${WS}/tasks/summary`]: json({ open: 0, completed: 0, overdue: 0, due_today: 0 }),
      [`POST ${WS}/tasks`]: ({ body }: MockRequest) =>
        Response.json(task({ id: "t-new", title: "Call bank", ...(body as object) }), {
          status: 201,
        }),
    });
    await renderSignedIn(<TaskWidget />);
    expect(await screen.findByText("Nothing due today. Enjoy the space.")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Task title" }), "Call bank{Enter}");

    await waitFor(() =>
      expect(sent(api, "POST", `${WS}/tasks`)).toEqual([
        { title: "Call bank", description: "", priority: "none", due_date: today },
      ]),
    );
  });

  it("shows recently completed tasks", async () => {
    const user = userEvent.setup();
    const done = task({ id: "t-done", title: "Renew passport", status: "completed" });
    const api = mockApi({
      ...session,
      [`GET ${WS}/tasks`]: ({ path }: MockRequest) => {
        void path;
        return Response.json({ tasks: [done], total: 1 });
      },
      [`GET ${WS}/tasks/summary`]: json({ open: 0, completed: 1, overdue: 0, due_today: 0 }),
    });
    await renderSignedIn(<TaskWidget />);

    await user.click(await screen.findByRole("button", { name: "Completed" }));

    expect(await screen.findByRole("checkbox", { name: "Reopen “Renew passport”" })).toBeChecked();
    const last = api.mock.calls.filter(([input]) => String(input).includes(`${WS}/tasks?`)).at(-1);
    expect(String(last?.[0])).toContain("status=completed");
    expect(String(last?.[0])).toContain("sort=completed_at");
  });
});

describe("HabitsWidget", () => {
  const read: Habit = {
    id: "h-read",
    name: "Read",
    category_id: null,
    description: "",
    icon: "book",
    color: "blue",
    kind: "boolean",
    unit: "",
    target: null,
    time_of_day: null,
    start_date: "2030-01-01",
    end_date: null,
    timezone: "UTC",
    status: "active",
    schedule: { type: "daily", every: 1, weekdays: [], month_days: [], times_per_week: 0 },
    schedule_history: [],
    pauses: [],
    created_at: "2030-01-01T09:00:00Z",
    updated_at: "2030-01-01T09:00:00Z",
  };
  const progress = (state: HabitProgress["state"]): HabitProgress => ({
    habit: read,
    day: today,
    state,
    log: null,
    period: { unit: "day", start: today, end: today, state: "pending", done: 0, required: 1 },
    week_done: 0,
    week_due: 7,
    current_streak: 3,
    longest_streak: 5,
    streak_unit: "day",
    total_completions: 10,
    completion_rate: 0.8,
    weekly_rate: 1,
    monthly_rate: 0.8,
  });
  const routine = {
    id: "r-morning",
    category_id: null,
    name: "Morning",
    description: "",
    icon: "sun",
    color: "amber",
    time_of_day: null,
    weekdays: [],
    timezone: "UTC",
    status: "active",
    steps: [],
    estimated_minutes: 10,
    created_at: "2030-01-01T09:00:00Z",
    updated_at: "2030-01-01T09:00:00Z",
    reminders: [],
    active_session: null,
    last_session: null,
    sessions_completed: 0,
  };

  it("checks a habit off on the habit's own log, and starts a routine", async () => {
    const user = userEvent.setup();
    let current = progress("pending");
    const api = mockApi({
      ...session,
      [`GET ${WS}/habits/today`]: () =>
        Response.json({ day: today, habits: [current], week: [], upcoming: [] }),
      [`PUT ${WS}/habits/h-read/log/${today}`]: () => {
        current = progress("completed");
        return Response.json(current);
      },
      [`GET ${WS}/routines`]: json({ routines: [routine] }),
      [`POST ${WS}/routines/r-morning/sessions`]: json({ id: "s1" }, 201),
    });
    await renderSignedIn(<HabitsWidget />);
    expect(await screen.findByText("0 of 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark Read done" }));

    expect(await screen.findByText("1 of 1")).toBeInTheDocument();
    expect(sent(api, "PUT", "/log/")).toEqual([expect.objectContaining({ status: "completed" })]);

    await user.click(screen.getByRole("button", { name: "Start Morning" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/habits?routine=r-morning"));
    expect(sent(api, "POST", "/routines/r-morning/sessions")).toHaveLength(1);
  });
});

describe("WaterWidget", () => {
  it("records water from a quick amount", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      [`GET ${WS}/fitness/profile`]: status(500),
      [`GET ${WS}/fitness/overview`]: json({
        day: today,
        active_session: null,
        completed_today: [],
        scheduled_today: [],
        recent_sessions: [],
        week_workouts: 0,
        weight_trend: [],
        goals: [],
        nutrition: {},
        targets: { water_ml: 2000 },
        water_ml: 500,
        recent_activities: [],
        records: [],
        hidden_sections: [],
      }),
      [`POST ${WS}/fitness/water`]: json({}, 201),
    });
    await renderSignedIn(<WaterWidget />);

    const group = await screen.findByRole("group", { name: "Add water" });
    await user.click(within(group).getAllByRole("button")[0] as HTMLElement);

    await waitFor(() =>
      expect(sent(api, "POST", "/fitness/water")).toEqual([{ day: today, amount_ml: 250 }]),
    );
  });
});

describe("QuickActionsWidget", () => {
  const routes = {
    ...session,
    [`GET ${WS}/routines`]: json({ routines: [] }),
  };

  it("records an expense with the Finance page's dialog, without leaving", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...routes,
      [`GET ${WS}/finance/accounts`]: json({
        accounts: [
          {
            id: "acc-1",
            workspace_id: personal.id,
            name: "Wallet",
            type: "cash",
            currency: "INR",
            opening_balance: 0,
            balance: 0,
            archived: false,
            notes: "",
            created_at: "2026-10-01T09:00:00Z",
            updated_at: "2026-10-01T09:00:00Z",
          },
        ],
        totals: [],
      }),
      [`GET ${WS}/finance/categories`]: json({ categories: [] }),
    });
    await withProviders(<QuickActionsWidget />);

    await user.click(screen.getByRole("button", { name: "Expense" }));

    expect(await screen.findByRole("dialog", { name: "Record a transaction" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(sent(api, "GET", "/finance/accounts").length).toBeGreaterThan(0);
  });

  it("opens the event dialog in place", async () => {
    const user = userEvent.setup();
    mockApi({ ...routes, [`GET ${WS}/calendar/categories`]: json({ categories: [] }) });
    await withProviders(<QuickActionsWidget />);

    await user.click(screen.getByRole("button", { name: "Event" }));

    expect(await screen.findByRole("dialog", { name: /event/i })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("records water at once and says so", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...routes,
      [`GET ${WS}/fitness/profile`]: status(500),
      [`POST ${WS}/fitness/water`]: json({}, 201),
    });
    await withProviders(<QuickActionsWidget />);

    await user.click(screen.getByRole("button", { name: "Record 250 ml of water" }));

    expect(await screen.findByText("Recorded 250 ml of water.")).toBeInTheDocument();
    expect(sent(api, "POST", "/fitness/water")).toHaveLength(1);
  });

  it("opens the vault's upload for documents", async () => {
    const user = userEvent.setup();
    mockApi(routes);
    await withProviders(<QuickActionsWidget />);

    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(push).toHaveBeenCalledWith("/documents?view=all&upload=1");
  });
});

describe("AttentionWidget", () => {
  it("lists what needs attention, each linking to its module", async () => {
    mockApi({
      ...session,
      [`GET ${WS}/dashboard/today`]: json({
        date: today,
        timezone: "UTC",
        generated_at: `${today}T08:00:00Z`,
        tasks: {
          open: 1,
          overdue: 1,
          due_today: 0,
          overdue_items: [task({ id: "t-late", title: "File taxes", due_date: "2020-01-01" })],
          due_today_items: [],
        },
        events: null,
        reminders: null,
        habits: null,
        documents: {
          expired: 1,
          expiring: 0,
          items: [{ id: "d-visa", title: "Visa", expiry_date: "2020-01-01" }],
        },
        payments: null,
        unavailable: ["payments"],
      }),
    });
    await renderSignedIn(<AttentionWidget />);

    expect(await screen.findByRole("link", { name: /File taxes/ })).toHaveAttribute(
      "href",
      "/tasks?task=t-late",
    );
    expect(screen.getByRole("link", { name: /Visa/ })).toHaveAttribute(
      "href",
      "/documents?document=d-visa",
    );
  });

  it("says when nothing needs attention", async () => {
    mockApi({
      ...session,
      [`GET ${WS}/dashboard/today`]: json({
        date: today,
        timezone: "UTC",
        generated_at: `${today}T08:00:00Z`,
        tasks: null,
        events: null,
        reminders: null,
        habits: null,
        documents: null,
        payments: null,
        unavailable: [],
      }),
    });
    await renderSignedIn(<AttentionWidget />);

    expect(await screen.findByText(/Nothing needs attention/)).toBeInTheDocument();
  });
});
