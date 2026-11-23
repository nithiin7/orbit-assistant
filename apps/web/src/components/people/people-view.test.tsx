import type { Person } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { chooseOption } from "@/test/controls";
import { renderSignedIn } from "@/test/session";

import { PeoplePanel } from "./people-view";

// The view and the open person come from the URL; each test picks its own.
let search = new URLSearchParams();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/people",
  useSearchParams: () => search,
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};
const PE = `/api/v1/workspaces/${personal.id}/people`;

function person(overrides: Partial<Person> & Pick<Person, "id" | "name">): Person {
  return {
    relationship: "friend",
    phone: "",
    email: "",
    note: "",
    favorite: false,
    dates: [],
    reminder_time: "09:00:00",
    timezone: "UTC",
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    ...overrides,
  } satisfies Person;
}

/** A date `days` from today, where the browser is. */
function inDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return { month: date.getMonth() + 1, day: date.getDate(), year: date.getFullYear() };
}

/** A stateful list, so mutations that refetch see their changes. */
function routes(initial: Person[]) {
  let items = initial;
  return {
    set: (next: Person[]) => {
      items = next;
    },
    route: {
      [`GET ${PE}`]: () => Response.json({ people: items }),
      [`GET /api/v1/workspaces/${personal.id}/reminders`]: json({ reminders: [] }),
    },
  };
}

afterEach(() => {
  search = new URLSearchParams();
  replace.mockReset();
});

describe("PeoplePanel", () => {
  it("invites a first person, then adds one with a birthday", async () => {
    const user = userEvent.setup();
    const store = routes([]);
    const sent: unknown[] = [];
    mockApi({
      ...session,
      ...store.route,
      [`POST ${PE}`]: (request: MockRequest) => {
        sent.push(request.body);
        const added = person({
          id: "p1",
          name: "Priya",
          dates: [{ kind: "birthday", label: "", month: 3, day: 20, remind_days_before: 0 }],
        });
        store.set([added]);
        return Response.json(added, { status: 201 });
      },
    });

    await renderSignedIn(<PeoplePanel />);

    expect(
      await screen.findByRole("heading", { name: "Keep your people close" }),
    ).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Add a person" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Add a person" });

    await user.click(within(dialog).getByRole("button", { name: "Add person" }));
    expect(await within(dialog).findByText("Add their name.")).toBeInTheDocument();

    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Priya");
    await chooseOption(user, within(dialog).getByRole("combobox", { name: "Month" }), "March");
    await chooseOption(user, within(dialog).getByRole("combobox", { name: "Day" }), "20");
    await user.click(within(dialog).getByRole("button", { name: "Add person" }));

    expect(await screen.findByRole("button", { name: "Priya" })).toBeInTheDocument();
    expect(sent).toEqual([
      {
        name: "Priya",
        relationship: "friend",
        phone: "",
        email: "",
        note: "",
        favorite: false,
        dates: [
          { kind: "birthday", label: "", month: 3, day: 20, year: null, remind_days_before: 0 },
        ],
        reminder_time: "09:00:00",
        timezone: expect.any(String),
      },
    ]);
  });

  it("lists favorites first and filters by name and relationship", async () => {
    const user = userEvent.setup();
    const soon = inDays(3);
    mockApi({
      ...session,
      ...routes([
        person({ id: "a", name: "Amma", relationship: "family", favorite: true }),
        person({
          id: "b",
          name: "Ben",
          relationship: "colleague",
          dates: [{ kind: "birthday", label: "", month: soon.month, day: soon.day }],
        }),
      ]).route,
    });

    await renderSignedIn(<PeoplePanel />);

    const favorites = await screen.findByRole("region", { name: "Favorites" });
    expect(within(favorites).getByRole("button", { name: "Amma" })).toBeInTheDocument();
    const others = screen.getByRole("region", { name: "Everyone else" });
    expect(within(others).getByText("In 3 days")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Upcoming dates\s*1/ })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Colleagues" }));
    expect(screen.queryByRole("button", { name: "Amma" })).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Everyone" }));
    await user.type(screen.getByRole("searchbox", { name: "Search people" }), "zzz");
    expect(screen.getByText("No one matches. Try another name.")).toBeInTheDocument();
  });

  it("celebrates today's birthdays and lists what's coming up", async () => {
    search = new URLSearchParams("view=upcoming");
    const today = inDays(0);
    const later = inDays(40);
    mockApi({
      ...session,
      ...routes([
        person({
          id: "a",
          name: "Priya",
          phone: "+91 98765 43210",
          dates: [
            {
              kind: "birthday",
              label: "",
              month: today.month,
              day: today.day,
              year: today.year - 30,
            },
          ],
        }),
        person({
          id: "b",
          name: "Sam",
          dates: [{ kind: "anniversary", label: "", month: later.month, day: later.day }],
        }),
      ]).route,
    });

    await renderSignedIn(<PeoplePanel />);

    const todays = await screen.findByRole("list", { name: "Today" });
    expect(within(todays).getByText("Priya turns 30 today")).toBeInTheDocument();
    expect(within(todays).getByRole("link", { name: "Call" })).toHaveAttribute(
      "href",
      "tel:+919876543210",
    );
    expect(screen.getByRole("button", { name: /Sam\s*Anniversary/ })).toBeInTheDocument();
  });

  it("opens a person from the link, edits only what changed, and deletes them", async () => {
    const user = userEvent.setup();
    search = new URLSearchParams("person=a");
    const store = routes([
      person({
        id: "a",
        name: "Priya",
        note: "Loves jasmine",
        dates: [{ kind: "birthday", label: "", month: 3, day: 20, remind_days_before: 7 }],
      }),
    ]);
    const patches: unknown[] = [];
    let deleted = false;
    mockApi({
      ...session,
      ...store.route,
      [`PATCH ${PE}/a`]: (request: MockRequest) => {
        patches.push(request.body);
        const updated = person({ id: "a", name: "Priya S", note: "Loves jasmine" });
        store.set([updated]);
        return Response.json(updated);
      },
      [`DELETE ${PE}/a`]: () => {
        deleted = true;
        store.set([]);
        return new Response(null, { status: 204 });
      },
    });

    await renderSignedIn(<PeoplePanel />);

    const detail = await screen.findByRole("dialog", { name: "Priya" });
    expect(within(detail).getByText("Loves jasmine")).toBeInTheDocument();
    expect(within(detail).getByText("Reminder a week before")).toBeInTheDocument();
    await user.click(within(detail).getByRole("button", { name: "Edit" }));

    const form = await screen.findByRole("dialog", { name: "Edit person" });
    const name = within(form).getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Priya S");
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(patches).toEqual([{ name: "Priya S" }]));
    expect(replace).toHaveBeenCalledWith("/people", { scroll: false });

    await user.click(await screen.findByRole("button", { name: "Actions for Priya S" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Delete Priya S?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleted).toBe(true));
    expect(
      await screen.findByRole("heading", { name: "Keep your people close" }),
    ).toBeInTheDocument();
  });
});
