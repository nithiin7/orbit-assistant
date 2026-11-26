import type { Task } from "@orbit/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { FocusTimer } from "./focus-timer";
import { FocusWidget } from "./focus-widget";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

const WORKSPACE = `/api/v1/workspaces/${personal.id}`;
const signedIn = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

const report: Task = {
  id: "t-report",
  workspace_id: personal.id,
  title: "Write the report",
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
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("FocusWidget", () => {
  it("shows today's focus time and starts the timer on a task", async () => {
    const user = userEvent.setup();
    mockApi({
      ...signedIn,
      [`GET ${WORKSPACE}/focus/summary`]: json({
        today_seconds: 3000,
        today_sessions: 2,
        tasks: [],
      }),
      [`GET ${WORKSPACE}/tasks`]: json({ tasks: [report], total: 1 }),
    });

    await renderSignedIn(
      <>
        <FocusWidget />
        <FocusTimer />
      </>,
    );

    const widget = await screen.findByRole("region", { name: "Focus" });
    expect(await within(widget).findByText("50m today · 2 sessions")).toBeInTheDocument();
    await user.click(within(widget).getByRole("button", { name: "Focus on “Write the report”" }));

    expect(within(widget).getByText("25:00")).toBeInTheDocument();
    expect(within(widget).getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Focus timer" })).toBeInTheDocument();
  });

  it("says when there's nothing to focus on", async () => {
    mockApi({
      ...signedIn,
      [`GET ${WORKSPACE}/focus/summary`]: json({ today_seconds: 0, today_sessions: 0, tasks: [] }),
      [`GET ${WORKSPACE}/tasks`]: json({ tasks: [], total: 0 }),
    });

    await renderSignedIn(<FocusWidget />);

    expect(await screen.findByText("No open tasks to focus on.")).toBeInTheDocument();
    expect(screen.getByText("No focus time yet today.")).toBeInTheDocument();
  });
});
