import type { Task } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { chooseOption } from "@/test/controls";
import { renderSignedIn } from "@/test/session";
import { localDateString } from "@/utils/dates";

import { TasksPanel } from "./tasks-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/tasks",
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};
const TASKS = `/api/v1/workspaces/${personal.id}/tasks`;

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
  localStorage.clear();
});

describe("TasksPanel", () => {
  it("lists open tasks by due date with their priority and due state", async () => {
    const api = mockApi({
      ...session,
      [`GET ${TASKS}`]: json({ tasks: [rent, plants], total: 2 }),
    });

    await renderSignedIn(<TasksPanel />);

    const list = await screen.findByRole("list", { name: "2 tasks" });
    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0]!).getByRole("checkbox", { name: "Pay rent" })).not.toBeChecked();
    expect(rows[0]).toHaveTextContent(/High priority/);
    expect(rows[0]).toHaveTextContent(/Due Overdue/);
    expect(rows[1]).toHaveTextContent(/Due Today/);
    const query = listQueries(api)[0];
    expect(query?.get("status")).toBe("open");
    expect(query?.get("sort")).toBe("due_date");
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
      { title: "Book dentist", description: "", priority: "medium", due_date: null },
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

  it("deletes a task after confirmation", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      [`GET ${TASKS}`]: json({ tasks: [rent, plants], total: 2 }),
      [`DELETE ${TASKS}/${rent.id}`]: status(204),
    });
    await renderSignedIn(<TasksPanel />);

    await user.click(await screen.findByRole("button", { name: "Delete “Pay rent”" }));
    const confirm = within(screen.getByRole("group", { name: "Delete “Pay rent”?" }));
    expect(confirm.getByRole("button", { name: "Delete" })).toHaveFocus();
    await user.click(confirm.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.queryByRole("checkbox", { name: "Pay rent" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("list", { name: "1 task" })).toBeInTheDocument();
    expect(api.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("cancels a deletion and returns focus to the delete button", async () => {
    const user = userEvent.setup();
    mockApi({ ...session, [`GET ${TASKS}`]: json({ tasks: [rent], total: 1 }) });
    await renderSignedIn(<TasksPanel />);

    await user.click(await screen.findByRole("button", { name: "Delete “Pay rent”" }));
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete “Pay rent”" })).toHaveFocus(),
    );
    expect(screen.getByRole("checkbox", { name: "Pay rent" })).toBeInTheDocument();
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

    await chooseOption(user, screen.getByRole("combobox", { name: "Filter by priority" }), "High");
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
});
