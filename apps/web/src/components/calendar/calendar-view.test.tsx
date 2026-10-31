import type {
  CalendarEvent,
  CalendarOccurrence,
  CalendarPreferences,
  Task,
} from "@orbit/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { CalendarPanel } from "./calendar-view";

// The URL, as a tiny store: `router.replace` changes it and the page re-renders, like Next.js.
const url = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  return {
    get: () => search,
    set: (next: unknown) => {
      if (typeof next !== "string") return;
      search = next.includes("?") ? next.slice(next.indexOf("?") + 1) : "";
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});
const navigate = vi.hoisted(() => vi.fn((href: string) => url.set(href)));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigate, replace: navigate }),
  usePathname: () => "/calendar",
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(url.subscribe, url.get, url.get)),
}));

const WS = `/api/v1/workspaces/${personal.id}`;
const CAL = `${WS}/calendar`;
const EVENT_ID = "eeeeeeee-0000-4000-8000-000000000001";

const preferences: CalendarPreferences = {
  default_view: "month",
  week_start: 1,
  working_hours_start: "09:00:00",
  working_hours_end: "17:00:00",
  show_completed_tasks: true,
  show_unscheduled_tasks: true,
  show_due_tasks: true,
  updated_at: null,
};

function occurrence(overrides: Partial<CalendarOccurrence> = {}): CalendarOccurrence {
  return {
    id: `${EVENT_ID}:2030-01-14T09:00`,
    event_id: EVENT_ID,
    original_start: "2030-01-14T09:00:00",
    title: "Standup",
    description: "",
    location: "",
    category_id: null,
    status: "confirmed",
    all_day: false,
    timezone: "UTC",
    start: "2030-01-14T09:00:00",
    end: "2030-01-14T09:30:00",
    start_at: "2030-01-14T09:00:00Z",
    end_at: "2030-01-14T09:30:00Z",
    recurring: false,
    modified: false,
    ...overrides,
  };
}

function task(overrides: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    workspace_id: personal.id,
    description: "",
    status: "open",
    priority: "none",
    due_date: null,
    completed_at: null,
    scheduled_start: null,
    scheduled_end: null,
    created_at: "2030-01-01T00:00:00Z",
    updated_at: "2030-01-01T00:00:00Z",
    ...overrides,
  };
}

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: EVENT_ID,
    workspace_id: personal.id,
    title: "Standup",
    description: "",
    location: "",
    category_id: null,
    all_day: false,
    timezone: "UTC",
    start: "2030-01-14T09:00:00",
    end: "2030-01-14T09:30:00",
    recurrence: null,
    status: "confirmed",
    series_id: null,
    created_at: "2030-01-01T00:00:00Z",
    updated_at: "2030-01-01T00:00:00Z",
    alerts: [],
    notes: [],
    tasks: [],
    next_occurrence: null,
    ...overrides,
  };
}

const report = task({ id: "tttttttt-0000-4000-8000-000000000001", title: "Write report" });
const rent = task({
  id: "tttttttt-0000-4000-8000-000000000002",
  title: "Pay rent",
  due_date: "2030-01-15",
});

function api(
  extra: Record<string, (request: MockRequest) => Response | Promise<Response>> = {},
  occurrences = [occurrence()],
) {
  return mockApi({
    "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
    "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
    "GET /api/v1/me/avatar": status(204),
    "GET /api/v1/workspaces": json({ workspaces: [personal] }),
    "GET /api/v1/me/calendar-preferences": json(preferences),
    [`GET ${CAL}/categories`]: json({
      categories: [
        { id: "c-work", name: "Work", color: "violet", is_visible: true, position: 0 },
        { id: "c-meeting", name: "Meeting", color: "teal", is_visible: true, position: 1 },
      ],
    }),
    [`GET ${CAL}/range`]: json({ occurrences, scheduled_tasks: [], due_tasks: [rent] }),
    [`GET ${WS}/tasks`]: json({ tasks: [report], total: 1 }),
    [`GET ${WS}/notes`]: json({ notes: [], total: 0 }),
    [`GET ${CAL}/events/${EVENT_ID}`]: json(event()),
    ...extra,
  });
}

function requests(fetchMock: ReturnType<typeof api>, method: string) {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? "GET") === method)
    .map(([input, init]) => ({
      url: new URL(String(input)),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    }));
}

beforeEach(() => {
  navigate.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  url.set("/calendar");
});

describe("Calendar", () => {
  it("shows a month with events and due tasks, and moves between months", async () => {
    const user = userEvent.setup();
    url.set("/calendar?view=month&date=2030-01-15");
    const fetchMock = api();
    await renderSignedIn(<CalendarPanel />);

    expect(await screen.findByRole("button", { name: /^Standup, / })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Task: Pay rent, Due" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /January 2030/ })).toBeInTheDocument();
    // The grid covers whole weeks, starting on Monday as preferred, in the user's time zone.
    const range = requests(fetchMock, "GET").find(({ url: u }) => u.pathname === `${CAL}/range`);
    expect(Object.fromEntries(range?.url.searchParams ?? [])).toMatchObject({
      start: "2029-12-31",
      end: "2030-02-04",
      timezone: "UTC",
    });

    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(navigate).toHaveBeenLastCalledWith("/calendar?view=month&date=2030-02-01", {
      scroll: false,
    });
    await user.click(screen.getByRole("button", { name: "Week" }));
    expect(navigate).toHaveBeenLastCalledWith("/calendar?view=week&date=2030-02-01", {
      scroll: false,
    });
  });

  it("creates an event from the dialog", async () => {
    const user = userEvent.setup();
    url.set("/calendar?view=week&date=2030-01-15");
    const fetchMock = api({ [`POST ${CAL}/events`]: json(event({ title: "Review" }), 201) });
    await renderSignedIn(<CalendarPanel />);

    await user.click(await screen.findByRole("button", { name: "New event" }));
    const dialog = await screen.findByRole("dialog", { name: "New event" });
    await user.type(within(dialog).getByLabelText("Title"), "Review");
    await user.click(within(dialog).getByRole("button", { name: /1 hour before/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(requests(fetchMock, "POST")).toHaveLength(1));
    expect(requests(fetchMock, "POST")[0]?.body).toMatchObject({
      title: "Review",
      start: "2030-01-15T09:00",
      end: "2030-01-15T10:00",
      timezone: "UTC",
      all_day: false,
      recurrence: null,
      alerts: [60],
      status: "confirmed",
      task_ids: [],
    });
  });

  it("opens an event's details and deletes it after confirming", async () => {
    const user = userEvent.setup();
    url.set("/calendar?view=week&date=2030-01-15");
    const fetchMock = api({ [`DELETE ${CAL}/events/${EVENT_ID}`]: status(204) });
    await renderSignedIn(<CalendarPanel />);

    await user.click(await screen.findByRole("button", { name: /^Standup, / }));
    const details = await screen.findByRole("dialog", { name: "Standup" });
    expect(within(details).getByText("No notes yet.")).toBeInTheDocument();
    await user.click(within(details).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Delete “Standup”?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(requests(fetchMock, "DELETE")).toHaveLength(1));
  });

  it("asks which occurrences a change to a repeating event applies to", async () => {
    const user = userEvent.setup();
    url.set("/calendar?view=day&date=2030-01-14");
    const repeating = occurrence({ recurring: true });
    const fetchMock = api(
      {
        [`GET ${CAL}/events/${EVENT_ID}`]: json(
          event({
            recurrence: { frequency: "daily", interval: 1, weekdays: [], count: null, until: null },
          }),
        ),
        [`PATCH ${CAL}/events/${EVENT_ID}/occurrences/2030-01-14T09%3A00`]: json(event()),
      },
      [repeating],
    );
    await renderSignedIn(<CalendarPanel />);

    await user.click(await screen.findByRole("button", { name: /^Standup, .*repeats/ }));
    const details = await screen.findByRole("dialog", { name: "Standup" });
    await user.click(within(details).getByRole("button", { name: "Edit" }));
    const scope = await screen.findByRole("dialog", { name: "Change a repeating event" });
    await user.click(within(scope).getByRole("radio", { name: /This event/ }));
    await user.click(within(scope).getByRole("button", { name: "Change" }));

    const editor = await screen.findByRole("dialog", { name: "Edit occurrence" });
    // A single occurrence can't change the series' rule or reminders.
    expect(within(editor).queryByText("Repeat")).not.toBeInTheDocument();
    const title = within(editor).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Planning");
    await user.click(within(editor).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(requests(fetchMock, "PATCH")).toHaveLength(1));
    expect(requests(fetchMock, "PATCH")[0]?.body).toEqual({ scope: "this", title: "Planning" });
  });

  it("moves an event by dragging it on the week grid", async () => {
    url.set("/calendar?view=week&date=2030-01-15");
    const fetchMock = api({
      [`PATCH ${CAL}/events/${EVENT_ID}/occurrences/2030-01-14T09%3A00`]: json(event()),
    });
    await renderSignedIn(<CalendarPanel />);
    const block = await screen.findByRole("button", { name: /^Standup, / });

    // Seven 100px columns, 48px per hour, starting at the page's top left.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 700,
      height: 1152,
      right: 700,
      bottom: 1152,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(block, { button: 0, clientX: 50, clientY: 9 * 48, pointerType: "mouse" });
    // To Tuesday at 10:00.
    fireEvent.pointerMove(window, { clientX: 150, clientY: 10 * 48 });
    fireEvent.pointerUp(window);

    await waitFor(() => expect(requests(fetchMock, "PATCH")).toHaveLength(1));
    expect(requests(fetchMock, "PATCH")[0]?.body).toEqual({
      scope: "this",
      start: "2030-01-15T10:00",
      end: "2030-01-15T10:30",
    });
  });

  it("schedules an unscheduled task without dragging", async () => {
    const user = userEvent.setup();
    url.set("/calendar?view=week&date=2030-01-15");
    const fetchMock = api({
      [`PATCH ${WS}/tasks/${report.id}`]: json({
        ...report,
        scheduled_start: "2030-01-15T09:00:00Z",
        scheduled_end: "2030-01-15T10:00:00Z",
      }),
    });
    await renderSignedIn(<CalendarPanel />);

    await user.click(await screen.findByRole("button", { name: "Schedule Write report" }));
    const dialog = await screen.findByRole("dialog", { name: /Schedule task/ });
    await user.click(within(dialog).getByRole("button", { name: "Schedule" }));

    await waitFor(() => expect(requests(fetchMock, "PATCH")).toHaveLength(1));
    expect(requests(fetchMock, "PATCH")[0]?.body).toEqual({
      scheduled_start: "2030-01-15T09:00:00.000Z",
      scheduled_end: "2030-01-15T10:00:00.000Z",
    });
  });

  it("lists the agenda by day, and says when nothing is coming up", async () => {
    url.set("/calendar?view=agenda&date=2030-01-14");
    api({
      [`GET ${CAL}/agenda`]: json({
        items: [
          { kind: "event", start_at: "2030-01-14T09:00:00Z", occurrence: occurrence(), task: null },
          {
            kind: "task",
            start_at: "2030-01-16T13:00:00Z",
            occurrence: null,
            task: {
              ...report,
              scheduled_start: "2030-01-16T13:00:00Z",
              scheduled_end: "2030-01-16T14:00:00Z",
            },
          },
        ],
        next_cursor: null,
      }),
    });
    const view = await renderSignedIn(<CalendarPanel />);

    expect(await screen.findByRole("button", { name: /^Standup, / })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Task: Write report/ })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    view.unmount();

    api({ [`GET ${CAL}/agenda`]: json({ items: [], next_cursor: null }) });
    await renderSignedIn(<CalendarPanel />);
    expect(await screen.findByText("Nothing coming up")).toBeInTheDocument();
  });
});
