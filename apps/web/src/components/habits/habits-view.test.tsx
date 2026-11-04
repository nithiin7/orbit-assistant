import type { Habit, HabitProgress, HabitToday, Routine } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { HabitsPanel } from "./habits-view";

const navigation = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: navigation.push }),
  usePathname: () => "/habits",
  useSearchParams: () => navigation.params,
}));

const WS = `/api/v1/workspaces/${personal.id}`;
const DAY = "2030-01-14";

function habit(overrides: Partial<Habit> & Pick<Habit, "id" | "name">): Habit {
  return {
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
    ...overrides,
  };
}

function progress(value: Habit, overrides: Partial<HabitProgress> = {}): HabitProgress {
  return {
    habit: value,
    day: DAY,
    state: "pending",
    log: null,
    period: { unit: "day", start: DAY, end: DAY, state: "pending", done: 0, required: 1 },
    week_done: 0,
    week_due: 7,
    current_streak: 3,
    longest_streak: 5,
    streak_unit: "day",
    total_completions: 10,
    completion_rate: 0.8,
    weekly_rate: 1,
    monthly_rate: 0.8,
    ...overrides,
  };
}

const read = habit({ id: "h-read", name: "Read" });
const water = habit({ id: "h-water", name: "Water", kind: "numeric", target: 3, unit: "litres" });

function today(habits: HabitProgress[]): HabitToday {
  return {
    day: DAY,
    habits,
    week: Array.from({ length: 7 }, (_, i) => ({
      day: `2030-01-${String(14 + i).padStart(2, "0")}`,
      due: 2,
      completed: 0,
      extra: 0,
    })),
    upcoming: [{ day: "2030-01-15", habit_ids: [read.id] }],
  };
}

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
  [`GET ${WS}/routines`]: json({ routines: [] }),
  [`GET ${WS}/habits/categories`]: json({ categories: [] }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  navigation.params = new URLSearchParams();
  navigation.push.mockReset();
});

describe("HabitsPanel: Today", () => {
  it("encourages a first habit when there are none", async () => {
    mockApi({ ...session, [`GET ${WS}/habits/today`]: json(today([])) });
    await renderSignedIn(<HabitsPanel />);
    expect(await screen.findByText("Start with one small habit")).toBeInTheDocument();
  });

  it("checks a habit off in one tap and shows it done at once", async () => {
    const user = userEvent.setup();
    let current = progress(read);
    const api = mockApi({
      ...session,
      [`GET ${WS}/habits/today`]: () => Response.json(today([current])),
      [`PUT ${WS}/habits/h-read/log/${DAY}`]: () => {
        current = progress(read, { state: "completed" });
        return Response.json(current);
      },
    });
    await renderSignedIn(<HabitsPanel />);
    const toDo = await screen.findByRole("region", { name: "To do" });
    expect(within(toDo).getByRole("link", { name: "Read" })).toBeInTheDocument();
    expect(screen.getByText("0 of 1 done · 0%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark Read done" }));
    expect(await screen.findByRole("region", { name: "Done" })).toBeInTheDocument();
    const put = api.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ status: "completed" });
  });

  it("cheers when a check-off meets the target", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      [`GET ${WS}/habits/today`]: json(today([progress(read), progress(water)])),
      [`PUT ${WS}/habits/h-read/log/${DAY}`]: json(
        progress(read, { state: "completed", current_streak: 4 }),
      ),
    });
    await renderSignedIn(<HabitsPanel />);
    await user.click(await screen.findByRole("button", { name: "Mark Read done" }));
    const cheer = await screen.findByText("Yay, target met!");
    expect(screen.getByRole("status")).toHaveTextContent("Read is done. That’s a 4-day streak.");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(cheer).not.toBeInTheDocument();
  });

  it("celebrates finishing the day, and stays quiet on undo", async () => {
    const user = userEvent.setup();
    let current = progress(read);
    mockApi({
      ...session,
      [`GET ${WS}/habits/today`]: () => Response.json(today([current])),
      [`PUT ${WS}/habits/h-read/log/${DAY}`]: () => {
        current = progress(read, { state: "completed" });
        return Response.json(current);
      },
      [`DELETE ${WS}/habits/h-read/log/${DAY}`]: () => {
        current = progress(read);
        return Response.json(current);
      },
    });
    await renderSignedIn(<HabitsPanel />);
    await user.click(await screen.findByRole("button", { name: "Mark Read done" }));
    expect(await screen.findByText("All done for today!")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    await user.click(await screen.findByRole("button", { name: "Undo Read" }));
    await screen.findByRole("button", { name: "Mark Read done" });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("records partial progress toward an amount", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      [`GET ${WS}/habits/today`]: json(today([progress(water)])),
      [`PUT ${WS}/habits/h-water/log/${DAY}`]: json(progress(water, { state: "partial" })),
    });
    await renderSignedIn(<HabitsPanel />);
    await user.click(await screen.findByRole("button", { name: "More actions for Water" }));
    await user.click(screen.getByRole("menuitem", { name: /Record progress/ }));
    await user.type(screen.getByLabelText("litres for Water"), "1.5");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const put = api.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ status: "progress", value: 1.5 });
    });
  });

  it("shows a load failure with a retry", async () => {
    mockApi({ ...session, [`GET ${WS}/habits/today`]: status(500, "Down for a moment.") });
    await renderSignedIn(<HabitsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Down for a moment.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("HabitsPanel: creating a habit", () => {
  it("sends the schedule and reminders the form describes", async () => {
    const user = userEvent.setup();
    const created = { ...progress(read), reminders: [], tasks: [], notes: [] };
    const api = mockApi({
      ...session,
      [`GET ${WS}/habits/today`]: json(today([])),
      [`GET ${WS}/habits`]: json({ habits: [] }),
      [`POST ${WS}/habits`]: json(created, 201),
    });
    await renderSignedIn(<HabitsPanel />);
    await user.click(await screen.findByRole("button", { name: "New" }));
    await user.click(screen.getByRole("menuitem", { name: /Habit/ }));
    const dialog = await screen.findByRole("dialog", { name: "New habit" });
    await user.type(within(dialog).getByLabelText("Name"), "Read");
    await user.click(within(dialog).getByRole("button", { name: "Add a reminder" }));
    await user.click(within(dialog).getByRole("button", { name: "Create habit" }));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/habits?habit=h-read"));
    const post = api.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      name: "Read",
      kind: "boolean",
      target: null,
      schedule: { type: "daily", every: 1 },
      timezone: "UTC",
      reminders: [{ time: "08:00", weekdays: [] }],
    });
  });
});

describe("HabitsPanel: templates", () => {
  it("opens the New habit form filled from a template", async () => {
    const user = userEvent.setup();
    navigation.params = new URLSearchParams("view=templates");
    const created = { ...progress(water), reminders: [], tasks: [], notes: [] };
    const api = mockApi({
      ...session,
      [`GET ${WS}/habits`]: json({ habits: [progress(read)] }),
      [`POST ${WS}/habits`]: json(created, 201),
    });
    await renderSignedIn(<HabitsPanel />);
    const nav = await screen.findByRole("navigation", { name: "Habit views" });
    expect(within(nav).getByRole("link", { name: "Templates" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      await screen.findByRole("button", { name: "Use the “Read” template, already tracking" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use the “Drink water” template" }));
    const dialog = await screen.findByRole("dialog", { name: "New habit" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Drink water");
    await user.click(within(dialog).getByRole("button", { name: "Create habit" }));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/habits?habit=h-water"));
    const post = api.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      name: "Drink water",
      kind: "numeric",
      target: 8,
      unit: "glasses",
    });
  });

  it("filters to routines and fills the New routine form", async () => {
    const user = userEvent.setup();
    navigation.params = new URLSearchParams("view=templates");
    mockApi({ ...session, [`GET ${WS}/habits`]: json({ habits: [] }) });
    await renderSignedIn(<HabitsPanel />);
    await user.click(await screen.findByRole("button", { name: "Routines" }));
    expect(screen.queryByRole("region", { name: "Habits" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use the “Morning routine” template" }));
    const dialog = await screen.findByRole("dialog", { name: "New routine" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Morning routine");
    expect(within(dialog).getByDisplayValue("Make the bed")).toBeInTheDocument();
  });

  it("offers starter habits when there are none", async () => {
    const user = userEvent.setup();
    mockApi({ ...session, [`GET ${WS}/habits/today`]: json(today([])) });
    await renderSignedIn(<HabitsPanel />);
    const starters = await screen.findByRole("list", { name: "Starter habits" });
    await user.click(within(starters).getByRole("button", { name: "Meditate" }));
    const dialog = await screen.findByRole("dialog", { name: "New habit" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Meditate");
  });
});

describe("HabitsPanel: routines", () => {
  const routine: Routine = {
    id: "r-morning",
    category_id: null,
    name: "Morning",
    description: "",
    icon: "sun",
    color: "amber",
    time_of_day: "07:00:00",
    weekdays: [],
    timezone: "UTC",
    status: "active",
    steps: [],
    estimated_minutes: 10,
    created_at: "2030-01-01T09:00:00Z",
    updated_at: "2030-01-01T09:00:00Z",
    reminders: [],
    last_session: null,
    sessions_completed: 0,
    active_session: {
      id: "s1",
      routine_id: "r-morning",
      day: DAY,
      routine_name: "Morning",
      status: "active",
      started_at: "2030-01-14T07:00:00Z",
      finished_at: null,
      notes: "",
      note_id: null,
      steps: [
        {
          id: "st-water",
          position: 0,
          name: "Glass of water",
          duration_minutes: 2,
          habit_id: null,
          task_id: null,
          status: "pending",
          completed_at: null,
        },
      ],
    },
  };

  it("runs a session: completes steps and finishes it", async () => {
    const user = userEvent.setup();
    navigation.params = new URLSearchParams("routine=r-morning");
    const session_ = routine.active_session;
    const api = mockApi({
      ...session,
      [`GET ${WS}/routines/r-morning`]: json(routine),
      [`GET ${WS}/routines/r-morning/sessions`]: json({ sessions: [], total: 0 }),
      [`PATCH ${WS}/routines/r-morning/sessions/s1/steps/st-water`]: json(session_),
      [`PATCH ${WS}/routines/r-morning/sessions/s1`]: json({ ...session_, status: "completed" }),
    });
    await renderSignedIn(<HabitsPanel />);
    await user.click(await screen.findByRole("button", { name: "Complete Glass of water" }));
    await user.type(screen.getByLabelText(/How did it go/), "Calm start");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => {
      const patches = api.mock.calls.filter(([, init]) => init?.method === "PATCH");
      expect(patches.map(([, init]) => JSON.parse(String(init?.body)) as unknown)).toEqual([
        { status: "completed" },
        { status: "completed", notes: "Calm start" },
      ]);
    });
  });
});
