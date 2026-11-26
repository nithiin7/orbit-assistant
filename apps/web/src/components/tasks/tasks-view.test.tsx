import type { Task } from "@orbit/contracts";
import { useQuery } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reminderKeys } from "@/api/reminders";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { chooseOption } from "@/test/controls";
import { renderSignedIn } from "@/test/session";
import { mockRowLayout, moveWithKeyboard } from "@/test/sortable";
import { localDateString } from "@/utils/dates";

import { TasksPanel } from "./tasks-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/tasks",
}));

const signedIn = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};
const TASKS = `/api/v1/workspaces/${personal.id}/tasks`;
const LISTS = `/api/v1/workspaces/${personal.id}/task-lists`;
const session = {
  ...signedIn,
  [`GET ${LISTS}`]: json({ lists: [] }),
  [`GET ${TASKS}/summary`]: json({ open: 2, completed: 5, overdue: 1, due_today: 1 }),
  [`GET /api/v1/workspaces/${personal.id}/focus/summary`]: json({
    today_seconds: 0,
    today_sessions: 0,
    tasks: [],
  }),
  // The task dialog lists the task's linked documents.
  [`GET /api/v1/workspaces/${personal.id}/documents`]: json({ documents: [], total: 0 }),
};

function daysFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateString(date);
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
    list_id: null,
    recurrence: null,
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

const rent = task({
  id: "t-rent",
  title: "Pay rent",
  priority: "high",
  due_date: daysFromToday(-2),
});
const plants = task({ id: "t-plants", title: "Water plants", due_date: daysFromToday(0) });

/** Query strings of every task list request, in order. */
function listQueries(api: ReturnType<typeof mockApi>): URLSearchParams[] {
  return api.mock.calls
    .map(([input, init]) => ({ url: new URL(String(input)), method: init?.method ?? "GET" }))
    .filter(({ url, method }) => method === "GET" && url.pathname === TASKS)
    .map(({ url }) => url.searchParams);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("TasksPanel", () => {
  it("groups open tasks by when they're due, with their priority and due state", async () => {
    const api = mockApi({
      ...session,
      [`GET ${TASKS}`]: json({ tasks: [rent, plants], total: 2 }),
    });

    await renderSignedIn(<TasksPanel />);

    const overdue = await screen.findByRole("list", { name: "Overdue, 1 task" });
    const [rentRow] = within(overdue).getAllByRole("listitem");
    expect(within(rentRow!).getByRole("checkbox", { name: "Pay rent" })).not.toBeChecked();
    expect(rentRow).toHaveTextContent(/High priority/);
    expect(rentRow).toHaveTextContent(/Due Overdue/);
    const dueToday = screen.getByRole("list", { name: "Today, 1 task" });
    expect(dueToday).toHaveTextContent(/Water plants/);
    expect(dueToday).toHaveTextContent(/Due Today/);
    expect(screen.getByText("2 tasks")).toBeInTheDocument();
    const query = listQueries(api)[0];
    expect(query?.get("status")).toBe("open");
    expect(query?.get("sort")).toBe("due_date");
  });

  it("shows what needs attention and counts each view", async () => {
    mockApi({ ...session, [`GET ${TASKS}`]: json({ tasks: [rent, plants], total: 2 }) });

    await renderSignedIn(<TasksPanel />);

    expect(await screen.findByText("1 overdue")).toBeInTheDocument();
    expect(screen.getByText("1 due today")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "1 task past due" })).toBeInTheDocument();
    // 5 of 7 tasks are done.
    expect(screen.getByRole("progressbar", { name: "Tasks completed" })).toHaveAttribute(
      "aria-valuenow",
      "71",
    );
    const views = within(screen.getByRole("group", { name: "Show" }));
    expect(views.getByRole("button", { name: "Open" })).toHaveTextContent("2");
    expect(views.getByRole("button", { name: "Completed" })).toHaveTextContent("5");
    expect(views.getByRole("button", { name: "All" })).toHaveTextContent("7");
  });

  it("shows one list, without due sections, in another sort", async () => {
    const user = userEvent.setup();
    mockApi({ ...session, [`GET ${TASKS}`]: json({ tasks: [rent, plants], total: 2 }) });
    await renderSignedIn(<TasksPanel />);
    await screen.findByRole("list", { name: "Overdue, 1 task" });

    await chooseOption(user, screen.getByRole("combobox", { name: "Sort by" }), "Sort: Priority");

    const list = await screen.findByRole("list", { name: "2 tasks" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("list", { name: /^Overdue/ })).not.toBeInTheDocument();
  });

  it("moves a task by its handle in My order", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      [`GET ${TASKS}`]: json({ tasks: [rent, plants], total: 2 }),
      [`POST ${TASKS}/${rent.id}/move`]: status(204),
    });
    await renderSignedIn(<TasksPanel />);
    await screen.findByRole("list", { name: "Overdue, 1 task" });
    // Other sorts have no handles; the API's order decides.
    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();

    await chooseOption(user, screen.getByRole("combobox", { name: "Sort by" }), "Sort: My order");
    const list = await screen.findByRole("list", { name: "2 tasks" });
    await waitFor(() => expect(listQueries(api).at(-1)?.get("sort")).toBe("manual"));
    mockRowLayout();
    await moveWithKeyboard(within(list).getByRole("button", { name: "Move “Pay rent”" }), 1);

    // The list shows the new order before the API answers.
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("Water plants");
    await waitFor(() => {
      const [move] = api.mock.calls.filter(([, init]) => init?.method === "POST");
      expect(move && JSON.parse(String(move[1]?.body))).toEqual({
        before_id: null,
        after_id: plants.id,
      });
    });
  });

  it("refreshes the counts after completing a task", async () => {
    const user = userEvent.setup();
    let summary = { open: 1, completed: 0, overdue: 1, due_today: 0 };
    mockApi({
      ...signedIn,
      [`GET ${TASKS}/summary`]: () => Response.json(summary),
      [`GET ${TASKS}`]: json({ tasks: [rent], total: 1 }),
      [`POST ${TASKS}/${rent.id}/complete`]: () => {
        summary = { open: 0, completed: 1, overdue: 0, due_today: 0 };
        return Response.json({
          ...rent,
          status: "completed",
          completed_at: "2026-10-29T10:00:00Z",
        });
      },
    });
    await renderSignedIn(<TasksPanel />);
    expect(await screen.findByText("1 overdue")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Pay rent" }));

    expect(await screen.findByText("Nothing overdue or due today.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Completed" })).toHaveTextContent("1");
  });

  it("explains an empty workspace", async () => {
    mockApi({ ...session, [`GET ${TASKS}`]: json({ tasks: [], total: 0 }) });

    await renderSignedIn(<TasksPanel />);

    expect(await screen.findByRole("heading", { name: "No open tasks" })).toBeInTheDocument();
  });

  it("adds a task from the keyboard and reloads the list in place", async () => {
    const user = userEvent.setup();
    const created = task({ id: "t-new", title: "Book dentist", priority: "medium" });
    let tasks: Task[] = [];
    const posted: unknown[] = [];
    mockApi({
      ...session,
      [`GET ${TASKS}`]: () => Response.json({ tasks, total: tasks.length }),
      [`POST ${TASKS}`]: ({ body }: MockRequest) => {
        posted.push(body);
        tasks = [created];
        return Response.json(created, { status: 201 });
      },
    });
    await renderSignedIn(<TasksPanel />);
    await screen.findByRole("heading", { name: "No open tasks" });

    await user.keyboard("n");
    const title = screen.getByRole("textbox", { name: "Task title" });
    expect(title).toHaveFocus();
    await chooseOption(user, screen.getByRole("combobox", { name: "Priority" }), "Medium");
    await user.type(title, "  Book dentist {Enter}");

    expect(await screen.findByRole("checkbox", { name: "Book dentist" })).toBeInTheDocument();
    expect(posted).toEqual([
      { title: "Book dentist", description: "", priority: "medium", due_date: null, list_id: null },
    ]);
    expect(title).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Added “Book dentist”.");
  });

  it("validates the title before sending anything", async () => {
    const user = userEvent.setup();
    const api = mockApi({ ...session, [`GET ${TASKS}`]: json({ tasks: [], total: 0 }) });
    await renderSignedIn(<TasksPanel />);

    await user.click(await screen.findByRole("button", { name: "Add task" }));

    expect(screen.getByRole("textbox", { name: "Task title" })).toHaveAccessibleDescription(
      "Enter a title.",
    );
    expect(api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("completes a task immediately and keeps it in view", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    mockApi({
      ...session,
      [`GET ${TASKS}`]: json({ tasks: [rent], total: 1 }),
      [`POST ${TASKS}/${rent.id}/complete`]: () =>
        new Promise((resolve) => {
          release = () =>
            resolve(
              Response.json({ ...rent, status: "completed", completed_at: "2026-10-29T10:00:00Z" }),
            );
        }),
    });
    await renderSignedIn(<TasksPanel />);

    const checkbox = await screen.findByRole("checkbox", { name: "Pay rent" });
    await user.click(checkbox);

    // Checked before the API answers.
    expect(checkbox).toBeChecked();
    release();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Completed “Pay rent”."),
    );
    expect(screen.getByRole("checkbox", { name: "Pay rent" })).toBeChecked();
  });

  it("shows the next occurrence after completing a repeating task", async () => {
    const user = userEvent.setup();
    const weekly = { frequency: "weekly", interval: 1 } as const;
    const repeating = { ...plants, recurrence: weekly };
    const next = task({
      id: "t-plants-2",
      title: "Water plants",
      due_date: daysFromToday(7),
      recurrence: weekly,
    });
    let tasks: Task[] = [repeating];
    const api = mockApi({
      ...session,
      [`GET ${TASKS}`]: () => Response.json({ tasks, total: tasks.length }),
      [`POST ${TASKS}/${plants.id}/complete`]: () => {
        tasks = [next];
        return Response.json({
          ...plants,
          status: "completed",
          completed_at: "2026-10-29T10:00:00Z",
        });
      },
    });
    await renderSignedIn(<TasksPanel />);

    expect(await screen.findByText("Every week")).toBeInTheDocument();
    await user.click(await screen.findByRole("checkbox", { name: "Water plants" }));

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Water plants" })).not.toBeChecked(),
    );
    const completion = api.mock.calls.find(([url]) => String(url).includes("/complete"));
    expect(String(completion?.[0])).toContain(`today=${daysFromToday(0)}`);
  });

  it("refreshes reminders after completing a repeating task", async () => {
    const user = userEvent.setup();
    const weekly = { frequency: "weekly", interval: 1 } as const;
    const loadReminders = vi.fn(() => Promise.resolve([]));
    function ReminderQuery() {
      useQuery({ queryKey: reminderKeys.all(personal.id), queryFn: loadReminders });
      return null;
    }
    mockApi({
      ...session,
      [`GET ${TASKS}`]: json({ tasks: [{ ...plants, recurrence: weekly }], total: 1 }),
      [`POST ${TASKS}/${plants.id}/complete`]: json({
        ...plants,
        status: "completed",
        completed_at: "2026-10-29T10:00:00Z",
      }),
    });
    await renderSignedIn(
      <>
        <TasksPanel />
        <ReminderQuery />
      </>,
    );
    await waitFor(() => expect(loadReminders).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole("checkbox", { name: "Water plants" }));

    await waitFor(() => expect(loadReminders).toHaveBeenCalledTimes(2));
  });

  it("sets a task to repeat from the edit dialog", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      [`GET ${TASKS}`]: json({ tasks: [plants], total: 1 }),
      [`PATCH ${TASKS}/${plants.id}`]: json({
        ...plants,
        recurrence: { frequency: "monthly", interval: 1 },
      }),
    });
    await renderSignedIn(<TasksPanel />);

    await user.click(await screen.findByRole("button", { name: "Edit “Water plants”" }));
    await user.click(screen.getByRole("combobox", { name: "Repeat" }));
    await user.click(await screen.findByRole("option", { name: "Every month" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      const patch = api.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
        recurrence: { frequency: "monthly", interval: 1 },
      });
    });
  });

  it("undoes the completion and reports it when the API refuses", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      [`GET ${TASKS}`]: json({ tasks: [rent], total: 1 }),
      [`POST ${TASKS}/${rent.id}/complete`]: status(503),
    });
    await renderSignedIn(<TasksPanel />);

    await user.click(await screen.findByRole("checkbox", { name: "Pay rent" }));

    const message = await screen.findByText(/database is unavailable/);
    expect(message.closest("[role=alert]")).not.toBeNull();
    expect(screen.getByRole("checkbox", { name: "Pay rent" })).not.toBeChecked();
  });

  it("edits a task in a dialog and sends only what changed", async () => {
    const user = userEvent.setup();
    const patches: unknown[] = [];
    let current = rent;
    mockApi({
      ...session,
      [`GET ${TASKS}`]: () => Response.json({ tasks: [current], total: 1 }),
      [`PATCH ${TASKS}/${rent.id}`]: ({ body }: MockRequest) => {
        patches.push(body);
        current = { ...rent, title: "Pay rent and bills", due_date: null };
        return Response.json(current);
      },
    });
    await renderSignedIn(<TasksPanel />);

    const opener = await screen.findByRole("button", { name: "Edit “Pay rent”" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Edit task" });
    const title = within(dialog).getByRole("textbox", { name: "Title" });
    expect(title).toHaveFocus();
    await user.clear(title);
    await user.type(title, "Pay rent and bills");
    await user.click(within(dialog).getByRole("button", { name: "Clear due date" }));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(patches).toEqual([{ title: "Pay rent and bills", due_date: null }]);
    expect(await screen.findByRole("checkbox", { name: "Pay rent and bills" })).toBeInTheDocument();
  });

  it("keeps the dialog open with a message when saving fails", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      [`GET ${TASKS}`]: json({ tasks: [rent], total: 1 }),
      [`PATCH ${TASKS}/${rent.id}`]: status(404, "Task not found."),
    });
    await renderSignedIn(<TasksPanel />);

    await user.click(await screen.findByRole("button", { name: "Edit “Pay rent”" }));
    const dialog = screen.getByRole("dialog", { name: "Edit task" });
    await chooseOption(user, within(dialog).getByRole("combobox", { name: "Priority" }), "Low");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Task not found.");
    expect(screen.getByRole("dialog", { name: "Edit task" })).toBeInTheDocument();
  });

  it("deletes a task at once and sends the delete when the Undo toast goes", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      [`GET ${TASKS}`]: json({ tasks: [rent, plants], total: 2 }),
      [`DELETE ${TASKS}/${rent.id}`]: status(204),
    });
    await renderSignedIn(<TasksPanel />);
    const deletes = () => api.mock.calls.filter(([, init]) => init?.method === "DELETE");

    await user.click(await screen.findByRole("button", { name: "Delete “Pay rent”" }));

    await waitFor(() =>
      expect(screen.queryByRole("checkbox", { name: "Pay rent" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("list", { name: /^Overdue/ })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Today, 1 task" })).toBeInTheDocument();
    expect(screen.getByText("Deleted “Pay rent”.")).toBeInTheDocument();
    // Nothing is sent while Undo is still on offer.
    expect(deletes()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(screen.queryByText("Deleted “Pay rent”.")).not.toBeInTheDocument();
  });

  it("brings a deleted task back on Undo without deleting it", async () => {
    const user = userEvent.setup();
    const api = mockApi({ ...session, [`GET ${TASKS}`]: json({ tasks: [rent], total: 1 }) });
    await renderSignedIn(<TasksPanel />);

    await user.click(await screen.findByRole("button", { name: "Delete “Pay rent”" }));
    await waitFor(() =>
      expect(screen.queryByRole("checkbox", { name: "Pay rent" })).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(await screen.findByRole("checkbox", { name: "Pay rent" })).toBeInTheDocument();
    expect(screen.queryByText("Deleted “Pay rent”.")).not.toBeInTheDocument();
    expect(api.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("brings a task back and says so when the delete fails", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      [`GET ${TASKS}`]: json({ tasks: [rent], total: 1 }),
      [`DELETE ${TASKS}/${rent.id}`]: status(500),
    });
    await renderSignedIn(<TasksPanel />);

    await user.click(await screen.findByRole("button", { name: "Delete “Pay rent”" }));
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));

    expect(await screen.findByRole("checkbox", { name: "Pay rent" })).toBeInTheDocument();
    expect(await screen.findByText(/Couldn’t delete the task/)).toBeInTheDocument();
  });

  it("searches after a pause and filters by status and priority", async () => {
    const user = userEvent.setup();
    const api = mockApi({ ...session, [`GET ${TASKS}`]: json({ tasks: [rent], total: 1 }) });
    await renderSignedIn(<TasksPanel />);
    await screen.findByRole("checkbox", { name: "Pay rent" });

    await user.keyboard("/");
    expect(screen.getByRole("searchbox", { name: "Search tasks" })).toHaveFocus();
    await user.keyboard("rent");
    await waitFor(() => expect(listQueries(api).at(-1)?.get("q")).toBe("rent"));
    // One request for the search, not one per keystroke.
    expect(listQueries(api).filter((query) => query.has("q"))).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.getByRole("button", { name: "Completed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => expect(listQueries(api).at(-1)?.get("status")).toBe("completed"));

    const priority = within(screen.getByRole("group", { name: "Priority" }));
    await user.click(priority.getByRole("button", { name: "High" }));
    expect(priority.getByRole("button", { name: "High" })).toHaveAttribute("aria-pressed", "true");
    await chooseOption(user, screen.getByRole("combobox", { name: "Sort by" }), "Sort: Priority");
    await waitFor(() => {
      const last = listQueries(api).at(-1);
      expect(last?.getAll("priority")).toEqual(["high"]);
      expect(last?.get("sort")).toBe("priority");
      expect(last?.get("q")).toBe("rent");
    });

    await user.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => expect(listQueries(api).at(-1)?.has("status")).toBe(false));
  });

  it("offers to clear filters when nothing matches", async () => {
    const user = userEvent.setup();
    const api = mockApi({ ...session, [`GET ${TASKS}`]: json({ tasks: [], total: 0 }) });
    await renderSignedIn(<TasksPanel />);
    await screen.findByRole("heading", { name: "No open tasks" });

    await user.type(screen.getByRole("searchbox", { name: "Search tasks" }), "zzz");
    await user.click(await screen.findByRole("button", { name: "Clear search and filters" }));

    expect(screen.getByRole("searchbox", { name: "Search tasks" })).toHaveValue("");
    expect(await screen.findByRole("heading", { name: "No open tasks" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No matching tasks" })).not.toBeInTheDocument();
    // The unfiltered list is still cached, so clearing the filters shows it without a request.
    expect(listQueries(api).filter((query) => !query.has("q"))).toHaveLength(1);
  });

  it("offers a retry when tasks can't be loaded", async () => {
    const user = userEvent.setup();
    let failing = true;
    mockApi({
      ...session,
      [`GET ${TASKS}`]: () =>
        failing ? new Response(null, { status: 503 }) : Response.json({ tasks: [rent], total: 1 }),
    });
    await renderSignedIn(<TasksPanel />);

    const message = await screen.findByText(/database is unavailable/);
    expect(message.closest("[role=alert]")).not.toBeNull();
    failing = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("checkbox", { name: "Pay rent" })).toBeInTheDocument();
  });

  it("says when more tasks exist than are shown", async () => {
    mockApi({ ...session, [`GET ${TASKS}`]: json({ tasks: [rent, plants], total: 250 }) });

    await renderSignedIn(<TasksPanel />);

    expect(await screen.findByText(/Showing 2 of 250 tasks/)).toBeInTheDocument();
  });

  describe("lists", () => {
    const work = {
      id: "l-work",
      name: "Work",
      color: "violet",
      position: 0,
      open_tasks: 1,
    } as const;
    const home = { id: "l-home", name: "Home", color: "teal", position: 1, open_tasks: 0 } as const;
    const report = task({ id: "t-report", title: "Send report", list_id: work.id });

    it("shows each task's list, and filters by list", async () => {
      const user = userEvent.setup();
      const api = mockApi({
        ...session,
        [`GET ${LISTS}`]: json({ lists: [work, home] }),
        [`GET ${TASKS}`]: json({ tasks: [report, rent], total: 2 }),
      });
      await renderSignedIn(<TasksPanel />);

      const row = (await screen.findByRole("checkbox", { name: "Send report" })).closest("li");
      expect(row).toHaveTextContent(/List: Work/);
      const lists = within(screen.getByRole("group", { name: "Lists" }));
      expect(lists.getByRole("button", { name: "Work, 1 open" })).toBeInTheDocument();

      await user.click(lists.getByRole("button", { name: "Work, 1 open" }));

      expect(lists.getByRole("button", { name: "Work, 1 open" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(await screen.findByRole("heading", { name: /^Work/ })).toBeInTheDocument();
      await waitFor(() => expect(listQueries(api).at(-1)?.get("list_id")).toBe(work.id));
      // The list in view goes without saying on its own tasks.
      await waitFor(() => expect(screen.queryByText(/List: Work/)).not.toBeInTheDocument());

      await user.click(lists.getByRole("button", { name: "No list" }));
      await waitFor(() => expect(listQueries(api).at(-1)?.get("unlisted")).toBe("true"));
    });

    it("creates a list, then adds tasks to it", async () => {
      const user = userEvent.setup();
      const created = { id: "l-new", name: "Errands", color: "amber", position: 0, open_tasks: 0 };
      let lists: (typeof created)[] = [];
      const posted: unknown[] = [];
      mockApi({
        ...session,
        [`GET ${LISTS}`]: () => Response.json({ lists }),
        [`POST ${LISTS}`]: ({ body }: MockRequest) => {
          posted.push(body);
          lists = [created];
          return Response.json(created, { status: 201 });
        },
        [`GET ${TASKS}`]: json({ tasks: [], total: 0 }),
        [`POST ${TASKS}`]: ({ body }: MockRequest) => {
          posted.push(body);
          return Response.json(task({ id: "t-milk", title: "Buy milk", list_id: created.id }), {
            status: 201,
          });
        },
      });
      await renderSignedIn(<TasksPanel />);

      await user.click(await screen.findByRole("button", { name: "New list" }));
      const dialog = screen.getByRole("dialog", { name: "New list" });
      await user.type(within(dialog).getByRole("textbox", { name: "List name" }), "Errands");
      await chooseOption(user, within(dialog).getByRole("combobox", { name: "Color" }), "Amber");
      await user.click(within(dialog).getByRole("button", { name: "Create list" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(
        await screen.findByRole("heading", { name: "Nothing on Errands to do" }),
      ).toBeVisible();
      // The new list is in view, so new tasks go on it.
      expect(screen.getByRole("combobox", { name: "List" })).toHaveTextContent("Errands");
      await user.type(screen.getByRole("textbox", { name: "Task title" }), "Buy milk{Enter}");

      await waitFor(() => expect(posted).toHaveLength(2));
      expect(posted).toEqual([
        { name: "Errands", color: "amber" },
        { title: "Buy milk", description: "", priority: "none", due_date: null, list_id: "l-new" },
      ]);
    });

    it("explains a taken name in the dialog", async () => {
      const user = userEvent.setup();
      mockApi({
        ...session,
        [`GET ${LISTS}`]: json({ lists: [work] }),
        [`POST ${LISTS}`]: json({ detail: "Another list already has that name." }, 409),
        [`GET ${TASKS}`]: json({ tasks: [], total: 0 }),
      });
      await renderSignedIn(<TasksPanel />);

      await user.click(await screen.findByRole("button", { name: "New list" }));
      const dialog = screen.getByRole("dialog", { name: "New list" });
      await user.type(within(dialog).getByRole("textbox", { name: "List name" }), "work");
      await user.click(within(dialog).getByRole("button", { name: "Create list" }));

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "Another list already has that name.",
      );
    });

    it("moves a task to a list from its details", async () => {
      const user = userEvent.setup();
      const patches: unknown[] = [];
      mockApi({
        ...session,
        [`GET ${LISTS}`]: json({ lists: [work, home] }),
        [`GET ${TASKS}`]: json({ tasks: [report], total: 1 }),
        [`PATCH ${TASKS}/${report.id}`]: ({ body }: MockRequest) => {
          patches.push(body);
          return Response.json({ ...report, list_id: home.id });
        },
      });
      await renderSignedIn(<TasksPanel />);

      await user.click(await screen.findByRole("button", { name: "Edit “Send report”" }));
      const dialog = screen.getByRole("dialog", { name: "Edit task" });
      await chooseOption(user, within(dialog).getByRole("combobox", { name: "List" }), "Home");
      await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(patches).toEqual([{ list_id: home.id }]));
    });

    it("deletes the list in view after confirming, keeping its tasks", async () => {
      const user = userEvent.setup();
      let lists: (typeof work)[] = [work];
      const deleted: string[] = [];
      const api = mockApi({
        ...session,
        [`GET ${LISTS}`]: () => Response.json({ lists }),
        [`DELETE ${LISTS}/${work.id}`]: ({ path }: MockRequest) => {
          deleted.push(path);
          lists = [];
          return new Response(null, { status: 204 });
        },
        [`GET ${TASKS}`]: json({ tasks: [report], total: 1 }),
      });
      await renderSignedIn(<TasksPanel />);
      await user.click(await screen.findByRole("button", { name: "Work, 1 open" }));

      await user.click(await screen.findByRole("button", { name: "Work list options" }));
      await user.click(screen.getByRole("menuitem", { name: "Delete list" }));
      const confirm = screen.getByRole("alertdialog", { name: "Delete “Work”?" });
      expect(confirm).toHaveTextContent("Its tasks are kept, on no list.");
      await user.click(within(confirm).getByRole("button", { name: "Delete list" }));

      await waitFor(() => expect(deleted).toHaveLength(1));
      expect(await screen.findByRole("heading", { name: "Open tasks" })).toBeInTheDocument();
      await waitFor(() => expect(listQueries(api).at(-1)?.get("list_id")).toBeNull());
    });
  });

  it("shows focused time and starts the focus timer on a task", async () => {
    mockApi({
      ...session,
      [`GET ${TASKS}`]: json({ tasks: [rent, plants], total: 2 }),
      [`GET /api/v1/workspaces/${personal.id}/focus/summary`]: json({
        today_seconds: 0,
        today_sessions: 0,
        tasks: [{ task_id: rent.id, focused_seconds: 3900, sessions: 3 }],
      }),
    });

    await renderSignedIn(<TasksPanel />);

    expect(await screen.findByText("1h 5m")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Focus on “Water plants”" }));

    expect(screen.getByText("Focusing on “Water plants” for 25 minutes.")).toBeInTheDocument();
    expect(screen.getByText(", focusing now")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Focus on “Water plants”" }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem("orbit:focus")).toContain(plants.id);
  });
});
