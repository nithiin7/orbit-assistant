import type { Reminder } from "@orbit/contracts";
import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { ReminderOverview } from "./reminder-overview";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

const UPCOMING = `/api/v1/workspaces/${personal.id}/reminders/upcoming`;

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

const standup: Reminder = {
  id: "r1",
  workspace_id: personal.id,
  task: null,
  title: "Stand-up notes",
  description: "",
  enabled: true,
  start_date: "2030-01-14",
  time_of_day: "09:00:00",
  timezone: "UTC",
  recurrence: { frequency: "weekly", weekdays: ["mon", "tue", "wed", "thu", "fri"] },
  status: "scheduled",
  next_occurrence_at: "2030-01-14T09:00:00Z",
  last_occurrence_at: null,
  last_outcome: null,
  created_at: "2026-10-01T09:00:00Z",
  updated_at: "2026-10-01T09:00:00Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("ReminderOverview", () => {
  it("lists the next reminders in the active workspace", async () => {
    const api = mockApi({ ...session, [`GET ${UPCOMING}`]: json({ reminders: [standup] }) });

    await renderSignedIn(<ReminderOverview />);

    const [row] = await screen.findAllByRole("listitem");
    expect(row).toHaveTextContent("Stand-up notes");
    expect(row).toHaveTextContent("Every weekday");
    expect(within(row!).getByText(/9:00/)).toHaveAttribute("dateTime", standup.next_occurrence_at);
    expect(screen.getByRole("link", { name: "Open reminders" })).toHaveAttribute(
      "href",
      "/reminders",
    );
    const url = new URL(String(api.mock.calls.find(([u]) => String(u).includes(UPCOMING))?.[0]));
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("invites creating a reminder when nothing is scheduled", async () => {
    mockApi({ ...session, [`GET ${UPCOMING}`]: json({ reminders: [] }) });

    await renderSignedIn(<ReminderOverview />);

    expect(await screen.findByText(/Nothing scheduled/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a reminder" })).toHaveAttribute(
      "href",
      "/reminders",
    );
  });
});
