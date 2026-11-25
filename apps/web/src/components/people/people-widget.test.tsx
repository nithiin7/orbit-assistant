import type { Person } from "@orbit/contracts";
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { PeopleWidget } from "./people-widget";

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
const PE = `/api/v1/workspaces/${personal.id}/people`;

function inDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return { month: date.getMonth() + 1, day: date.getDate() };
}

function person(id: string, name: string, days: number | null): Person {
  return {
    id,
    name,
    relationship: "friend",
    phone: "",
    email: "",
    note: "",
    favorite: false,
    dates: days === null ? [] : [{ kind: "birthday", label: "", ...inDays(days) }],
    reminder_time: "09:00:00",
    timezone: "UTC",
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
  };
}

describe("PeopleWidget", () => {
  it("lists the next month's dates, soonest first, linking to each person", async () => {
    mockApi({
      ...session,
      [`GET ${PE}`]: json({
        people: [person("a", "Amma", 12), person("b", "Ben", 1), person("c", "Cy", 90)],
      }),
    });

    await renderSignedIn(<PeopleWidget />);

    const list = await screen.findByRole("list");
    const links = within(list).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining("Ben"),
      expect.stringContaining("Amma"),
    ]);
    expect(links[0]).toHaveAttribute("href", "/people?view=upcoming&person=b");
    expect(within(links[0]!).getByText("Tomorrow")).toBeInTheDocument();
  });

  it("invites a first person", async () => {
    mockApi({ ...session, [`GET ${PE}`]: json({ people: [] }) });
    await renderSignedIn(<PeopleWidget />);
    expect(await screen.findByRole("link", { name: "Add a person" })).toHaveAttribute(
      "href",
      "/people",
    );
  });

  it("says when nothing is coming up", async () => {
    mockApi({ ...session, [`GET ${PE}`]: json({ people: [person("a", "Amma", null)] }) });
    await renderSignedIn(<PeopleWidget />);
    expect(
      await screen.findByText("No birthdays or anniversaries in the next 30 days."),
    ).toBeInTheDocument();
  });
});
