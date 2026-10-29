import type { Notification } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, lab, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { NotificationBell } from "./notification-bell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

const NOTIFICATIONS = "/api/v1/me/notifications";

function notification(overrides: Partial<Notification> & Pick<Notification, "id" | "title">) {
  return {
    workspace_id: personal.id,
    reminder_id: "r1",
    body: "",
    scheduled_for: "2030-01-15T08:00:00Z",
    created_at: "2030-01-15T08:00:00Z",
    read_at: null,
    ...overrides,
  } satisfies Notification;
}

const dentist = notification({ id: "n1", title: "Call the dentist", body: "Ask about Friday." });
const rent = notification({
  id: "n2",
  title: "Pay rent",
  workspace_id: lab.id,
  read_at: "2030-01-15T09:00:00Z",
});

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal, lab] }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("NotificationBell", () => {
  it("shows the unread count and lists notifications from every workspace", async () => {
    mockApi({
      ...session,
      [`GET ${NOTIFICATIONS}/unread-count`]: json({ unread: 1 }),
      [`GET ${NOTIFICATIONS}`]: json({ notifications: [dentist, rent], total: 2, unread: 1 }),
    });
    const user = userEvent.setup();
    await renderSignedIn(<NotificationBell />);

    const bell = await screen.findByRole("button", { name: "Notifications, 1 unread" });
    await user.click(bell);

    const panel = screen.getByRole("region", { name: "Notifications" });
    const [first, second] = await within(panel).findAllByRole("listitem");
    expect(first).toHaveTextContent("Unread: Call the dentist");
    expect(first).toHaveTextContent("Ask about Friday.");
    // Notifications from a workspace other than the active one name it.
    expect(second).toHaveTextContent("Pay rent");
    expect(second).toHaveTextContent("Lab");
    expect(bell).toHaveAttribute("aria-expanded", "true");
  });

  it("marks one notification read, and then all of them", async () => {
    let unread = 2;
    const second = notification({ id: "n3", title: "Stretch" });
    const api = mockApi({
      ...session,
      [`GET ${NOTIFICATIONS}/unread-count`]: () => Response.json({ unread }),
      [`GET ${NOTIFICATIONS}`]: () =>
        Response.json({
          notifications:
            unread === 0
              ? [
                  { ...dentist, read_at: "2030-01-15T10:00:00Z" },
                  { ...second, read_at: "2030-01-15T10:00:00Z" },
                ]
              : [dentist, second],
          total: 2,
          unread,
        }),
      [`PATCH ${NOTIFICATIONS}/n1`]: (request: MockRequest) => {
        unread = 1;
        expect(request.body).toEqual({ read: true });
        return Response.json({ ...dentist, read_at: "2030-01-15T10:00:00Z" });
      },
      [`POST ${NOTIFICATIONS}/read-all`]: () => {
        unread = 0;
        return Response.json({ count: 1 });
      },
    });
    const user = userEvent.setup();
    await renderSignedIn(<NotificationBell />);
    await user.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));

    await user.click(
      await screen.findByRole("button", { name: "Mark “Call the dentist” as read" }),
    );
    expect(
      await screen.findByRole("button", { name: "Mark “Call the dentist” as unread" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mark all read" })).toBeDisabled(),
    );
    expect(api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("shows an empty inbox and closes with Escape, returning focus to the bell", async () => {
    mockApi({
      ...session,
      [`GET ${NOTIFICATIONS}/unread-count`]: json({ unread: 0 }),
      [`GET ${NOTIFICATIONS}`]: json({ notifications: [], total: 0, unread: 0 }),
    });
    const user = userEvent.setup();
    await renderSignedIn(<NotificationBell />);

    const bell = await screen.findByRole("button", { name: "Notifications" });
    await user.click(bell);
    expect(await screen.findByText("You’re all caught up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeDisabled();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("region", { name: "Notifications" })).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });

  it("reports a failure to load notifications", async () => {
    mockApi({
      ...session,
      [`GET ${NOTIFICATIONS}/unread-count`]: json({ unread: 0 }),
      [`GET ${NOTIFICATIONS}`]: status(503),
    });
    const user = userEvent.setup();
    await renderSignedIn(<NotificationBell />);

    await user.click(await screen.findByRole("button", { name: "Notifications" }));

    expect(await screen.findByText(/database is unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
