import type { Task } from "@orbit/contracts";
import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { localDateString } from "@/lib/tasks";
import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { TaskOverview } from "./task-overview";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};
const TASKS = `/api/v1/workspaces/${personal.id}/tasks`;

const rent: Task = {
  id: "t-rent",
  workspace_id: personal.id,
  title: "Pay rent",
  description: "",
  status: "open",
  priority: "high",
  due_date: localDateString(),
  completed_at: null,
  created_at: "2026-10-01T09:00:00Z",
  updated_at: "2026-10-01T09:00:00Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("TaskOverview", () => {
  it("shows counts for the user's local date and the next open tasks", async () => {
    const api = mockApi({
      ...session,
      [`GET ${TASKS}/summary`]: json({ open: 3, completed: 7, overdue: 1, due_today: 2 }),
      [`GET ${TASKS}`]: json({ tasks: [rent], total: 3 }),
    });

    await renderSignedIn(<TaskOverview />);

    expect(await screen.findByText("Overdue")).toBeInTheDocument();
    const stats = Object.fromEntries(
      screen
        .getAllByRole("term")
        .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
    );
    expect(stats).toEqual({ Open: "3", "Due today": "2", Overdue: "1", Completed: "7" });
    const upNext = screen.getByRole("list");
    expect(within(upNext).getByText("Pay rent")).toBeInTheDocument();
    expect(within(upNext).getByText("Today")).toBeInTheDocument();

    const urls = api.mock.calls.map(([input]) => new URL(String(input)));
    const summary = urls.find((url) => url.pathname === `${TASKS}/summary`);
    expect(summary?.searchParams.get("today")).toBe(localDateString());
    const list = urls.find((url) => url.pathname === TASKS);
    expect(list?.searchParams.get("status")).toBe("open");
    expect(list?.searchParams.get("sort")).toBe("due_date");
  });

  it("links to the Tasks page when there is nothing to do", async () => {
    mockApi({
      ...session,
      [`GET ${TASKS}/summary`]: json({ open: 0, completed: 0, overdue: 0, due_today: 0 }),
      [`GET ${TASKS}`]: json({ tasks: [], total: 0 }),
    });

    await renderSignedIn(<TaskOverview />);

    expect(await screen.findByText(/No tasks in this workspace yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a task" })).toHaveAttribute("href", "/tasks");
  });

  it("offers a retry when the summary can't be loaded", async () => {
    mockApi({
      ...session,
      [`GET ${TASKS}/summary`]: status(503),
      [`GET ${TASKS}`]: json({ tasks: [], total: 0 }),
    });

    await renderSignedIn(<TaskOverview />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/database is unavailable/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
