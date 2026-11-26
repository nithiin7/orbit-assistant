import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { startFocus } from "@/lib/focus";
import { playChime } from "@/lib/focus/chime";
import { FOCUS_SETTINGS_STORAGE_KEY, FOCUS_STORAGE_KEY, useFocusTimer } from "@/providers/focus";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { chooseOption } from "@/test/controls";
import { renderSignedIn } from "@/test/session";

import { FocusTimer } from "./focus-timer";

vi.mock("@/lib/focus/chime", () => ({
  playChime: vi.fn(),
  notificationsSupported: () => false,
  notifyInBackground: vi.fn(),
}));

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
const SESSIONS = `/api/v1/workspaces/${personal.id}/tasks/t-report/focus-sessions`;
const TASK = { workspaceId: personal.id, taskId: "t-report", taskTitle: "Write the report" };

function StartButton() {
  const { start } = useFocusTimer();
  return (
    <button type="button" onClick={() => start(TASK)}>
      Start
    </button>
  );
}

afterEach(() => {
  vi.mocked(playChime).mockClear();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("FocusTimer", () => {
  it("shows nothing until a timer starts, then counts down and pauses", async () => {
    mockApi(signedIn);
    await renderSignedIn(
      <>
        <StartButton />
        <FocusTimer />
      </>,
    );
    expect(screen.queryByRole("region", { name: "Focus timer" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Start" }));

    const timer = screen.getByRole("region", { name: "Focus timer" });
    expect(within(timer).getByRole("timer")).toHaveTextContent("25:00");
    expect(within(timer).getByText("Write the report")).toBeInTheDocument();

    await userEvent.click(within(timer).getByRole("button", { name: "Pause" }));
    expect(within(timer).getByText("· Paused")).toBeInTheDocument();
    expect(within(timer).getByRole("button", { name: "Resume" })).toBeInTheDocument();
    // The timer is saved, so it survives a reload.
    expect(localStorage.getItem(FOCUS_STORAGE_KEY)).toContain("t-report");
  });

  it("stops without recording a session shorter than a minute", async () => {
    const api = mockApi(signedIn);
    await renderSignedIn(
      <>
        <StartButton />
        <FocusTimer />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await userEvent.click(screen.getByRole("button", { name: "Stop the focus timer" }));

    expect(screen.queryByRole("region", { name: "Focus timer" })).not.toBeInTheDocument();
    expect(localStorage.getItem(FOCUS_STORAGE_KEY)).toBeNull();
    expect(api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("records a session that finished while the page was closed and starts the break", async () => {
    const recorded: MockRequest[] = [];
    mockApi({
      ...signedIn,
      [`POST ${SESSIONS}`]: (request) => {
        recorded.push(request);
        return Response.json({}, { status: 201 });
      },
      // Recording a session checks achievements.
      "POST /api/v1/me/achievements/check": status(204),
    });
    const startedAt = Date.now() - 27 * 60_000;
    localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(startFocus(TASK, startedAt)));

    await renderSignedIn(<FocusTimer />);

    await waitFor(() => expect(recorded).toHaveLength(1));
    expect(recorded[0]?.body).toMatchObject({
      started_at: new Date(startedAt).toISOString(),
      ended_at: new Date(startedAt + 25 * 60_000).toISOString(),
      focused_seconds: 1500,
      completed: true,
    });
    expect(await screen.findByText(/Session done: 25m on “Write the report”/)).toBeInTheDocument();
    const timer = screen.getByRole("region", { name: "Focus timer" });
    expect(within(timer).getByText("Short break")).toBeInTheDocument();
    expect(within(timer).getByRole("button", { name: "Skip the break" })).toBeInTheDocument();
  });

  it("says so when a session can't be saved", async () => {
    mockApi({ ...signedIn, [`POST ${SESSIONS}`]: status(404, "Task not found.") });
    localStorage.setItem(
      FOCUS_STORAGE_KEY,
      JSON.stringify(startFocus(TASK, Date.now() - 26 * 60_000)),
    );

    await renderSignedIn(<FocusTimer />);

    expect(
      await screen.findByText("Couldn’t save your focus time on “Write the report”."),
    ).toBeInTheDocument();
  });

  it("chimes when a phase ends now, but not for one that ended long ago", async () => {
    mockApi({
      ...signedIn,
      [`POST ${SESSIONS}`]: () => Response.json({}, { status: 201 }),
    });
    localStorage.setItem(
      FOCUS_STORAGE_KEY,
      JSON.stringify(startFocus(TASK, Date.now() - 25 * 60_000 - 2000)),
    );
    const view = await renderSignedIn(<FocusTimer />);
    await screen.findByText(/Session done/);
    expect(playChime).toHaveBeenCalledTimes(1);
    view.unmount();

    vi.mocked(playChime).mockClear();
    localStorage.setItem(
      FOCUS_STORAGE_KEY,
      JSON.stringify(startFocus(TASK, Date.now() - 27 * 60_000)),
    );
    await renderSignedIn(<FocusTimer />);
    await screen.findByText(/Session done/);
    expect(playChime).not.toHaveBeenCalled();
  });

  it("starts new timers with the lengths chosen in settings", async () => {
    const user = userEvent.setup();
    mockApi(signedIn);
    await renderSignedIn(
      <>
        <StartButton />
        <FocusTimer />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("button", { name: "Focus timer settings" }));

    const dialog = screen.getByRole("dialog", { name: "Focus timer settings" });
    expect(within(dialog).getByText(/The timer running now keeps its lengths/)).toBeInTheDocument();
    await chooseOption(user, within(dialog).getByRole("combobox", { name: "Focus" }), "50 minutes");
    await user.click(within(dialog).getByRole("checkbox", { name: "Play a soft chime" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(JSON.parse(localStorage.getItem(FOCUS_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
      focusMinutes: 50,
      sound: false,
    });
    // The running timer keeps its 25 minutes; the next one runs for 50.
    expect(screen.getByRole("timer")).toHaveTextContent(/^2[45]:/);
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("timer")).toHaveTextContent("50:00");
  });
});
