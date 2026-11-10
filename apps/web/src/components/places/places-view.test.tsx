import type { Place, PlaceSettings } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { chooseOption } from "@/test/controls";
import { renderSignedIn } from "@/test/session";

import { PlacesPanel } from "./places-view";

// The view comes from the URL; each test picks its own.
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/places",
  useSearchParams: () => search,
}));

// WebGL maps can't run in jsdom; the lists and stats carry the behavior under test.
vi.mock("./world-map", () => ({
  WorldMap: ({ label, styleUrl }: { label: string; styleUrl: string | null }) => (
    <div role="img" aria-label={label} data-style={styleUrl ?? "offline"} />
  ),
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};
const PL = `/api/v1/workspaces/${personal.id}/places`;

function place(overrides: Partial<Place> & Pick<Place, "id" | "name" | "country_code">): Place {
  return {
    locality: "",
    location: null,
    status: "visited",
    visited_on: null,
    favorite: false,
    note: "",
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    ...overrides,
  } satisfies Place;
}

const OFFLINE: PlaceSettings = {
  online_maps: false,
  online_maps_allowed: true,
  map_style_url: null,
};
const ONLINE: PlaceSettings = {
  online_maps: true,
  online_maps_allowed: true,
  map_style_url: "https://tiles.example/style",
};

/** A stateful list, so mutations that refetch see their changes. */
function routes(initial: Place[], settings: PlaceSettings = OFFLINE) {
  let items = initial;
  return {
    set: (next: Place[]) => {
      items = next;
    },
    route: {
      [`GET ${PL}/items`]: () => Response.json({ places: items }),
      [`GET ${PL}/settings`]: () => Response.json(settings),
    },
  };
}

afterEach(() => {
  search = new URLSearchParams();
});

describe("PlacesPanel", () => {
  it("invites a first place, then adds one offline with a name and a country", async () => {
    const user = userEvent.setup();
    const store = routes([]);
    const sent: unknown[] = [];
    mockApi({
      ...session,
      ...store.route,
      [`POST ${PL}/items`]: (request: MockRequest) => {
        sent.push(request.body);
        const added = place({ id: "p1", name: "Lisbon", country_code: "PT" });
        store.set([added]);
        return Response.json(added, { status: 201 });
      },
    });

    await renderSignedIn(<PlacesPanel />);

    expect(await screen.findByRole("heading", { name: "Start your map" })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Add a place" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Add a place" });
    // Offline, there's no place search.
    expect(within(dialog).queryByRole("searchbox", { name: "Find a place" })).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Add place" }));
    expect(await within(dialog).findByText("Name the place.")).toBeInTheDocument();

    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Lisbon");
    await chooseOption(user, within(dialog).getByRole("combobox", { name: "Country" }), "Portugal");
    await user.click(within(dialog).getByRole("button", { name: "Add place" }));

    expect(
      await screen.findByRole("img", { name: /World map with 1 country visited/ }),
    ).toHaveAttribute("data-style", "offline");
    expect(sent).toEqual([
      {
        name: "Lisbon",
        locality: "",
        country_code: "PT",
        status: "visited",
        location: null,
        visited_on: null,
        favorite: false,
        note: "",
      },
    ]);
  });

  it("shows how much of the world you've seen", async () => {
    mockApi({
      ...session,
      ...routes([
        place({ id: "1", name: "Kyoto", country_code: "JP" }),
        place({ id: "2", name: "Lisbon", country_code: "PT" }),
        place({ id: "3", name: "Hong Kong", country_code: "HK" }),
        place({ id: "4", name: "Reykjavik", country_code: "IS", status: "want_to_visit" }),
      ]).route,
    });

    await renderSignedIn(<PlacesPanel />);

    const numbers = await screen.findByRole("region", { name: "Your travels in numbers" });
    expect(within(numbers).getByText("plus 1 other region")).toBeInTheDocument();
    expect(within(numbers).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
    expect(within(numbers).getByText("2 / 7")).toBeInTheDocument();
    const continents = screen.getByRole("list", { name: "Continents" });
    expect(within(continents).getByRole("listitem", { name: "Asia" })).toHaveTextContent(
      "(visited)",
    );
    expect(within(continents).getByRole("listitem", { name: "Africa" })).toHaveTextContent(
      "Still to explore",
    );
    expect(
      screen.getByRole("img", { name: "World map with 2 countries visited and 1 more to go." }),
    ).toBeInTheDocument();
    const passport = screen.getByRole("list", { name: "Countries you’ve visited" });
    expect(within(passport).getByText("Japan")).toBeInTheDocument();
    expect(within(passport).getAllByRole("listitem")).toHaveLength(3);
    // Milestones: the first country is unlocked; a third continent is closest.
    const badges = screen.getByRole("list", { name: "Milestones" });
    expect(within(badges).getByText(/First country/)).toHaveTextContent("(unlocked)");
    expect(screen.getByRole("progressbar", { name: "Progress to 3 continents" })).toHaveAttribute(
      "aria-valuenow",
      "67",
    );
    expect(screen.getByText("· 1 more continent to go")).toBeInTheDocument();
    // Highlights: the most explored country and what's next.
    expect(screen.getByRole("link", { name: /Reykjavik/ })).toHaveAttribute(
      "href",
      "/places?view=wishlist",
    );
    // Counts in the rail.
    expect(screen.getByRole("link", { name: /Visited\s*3/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Want to go\s*1/ })).toBeInTheDocument();
  });

  it("shows visited places as country cards, filters them, and switches to a timeline", async () => {
    const user = userEvent.setup();
    search = new URLSearchParams("view=visited");
    mockApi({
      ...session,
      ...routes([
        place({ id: "1", name: "Kyoto", country_code: "JP", visited_on: "2024-04-02" }),
        place({ id: "2", name: "Tokyo", country_code: "JP", visited_on: "2025-01-10" }),
        place({ id: "3", name: "Lisbon", country_code: "PT" }),
      ]).route,
    });

    await renderSignedIn(<PlacesPanel />);

    const countries = await screen.findByRole("list", { name: "Countries" });
    const japan = within(countries).getByRole("listitem", { name: "Japan" });
    expect(within(japan).getByText(/Asia · 2 places/)).toBeInTheDocument();
    expect(within(japan).getByRole("button", { name: /^Tokyo/ })).toBeInTheDocument();
    expect(screen.getByText("3 places in 2 countries")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Europe" }));
    expect(within(countries).queryByRole("listitem", { name: "Japan" })).toBeNull();
    expect(screen.getByText("1 place in 1 country")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "All continents" }));

    await user.type(screen.getByRole("searchbox", { name: "Filter places" }), "zzz");
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Filter places" }));

    await user.click(screen.getByRole("radio", { name: "Timeline" }));
    const timeline = screen.getByRole("list", { name: "Timeline" });
    const years = within(timeline)
      .getAllByRole("heading")
      .map((heading) => heading.textContent);
    expect(years).toEqual(["2025", "2024", "Undated"]);
  });

  it("marks a wished-for place as visited, celebrating a new country", async () => {
    const user = userEvent.setup();
    search = new URLSearchParams("view=wishlist");
    const sent: unknown[] = [];
    const reykjavik = place({
      id: "w1",
      name: "Reykjavik",
      country_code: "IS",
      status: "want_to_visit",
      note: "Northern lights",
    });
    const store = routes([place({ id: "v1", name: "Kyoto", country_code: "JP" }), reykjavik]);
    mockApi({
      ...session,
      ...store.route,
      [`PATCH ${PL}/items/w1`]: (request: MockRequest) => {
        sent.push(request.body);
        const updated = { ...reykjavik, ...(request.body as Partial<Place>) };
        store.set([place({ id: "v1", name: "Kyoto", country_code: "JP" }), updated]);
        return Response.json(updated);
      },
    });

    await renderSignedIn(<PlacesPanel />);

    const cards = await screen.findByRole("list", { name: "Places you want to go" });
    const card = within(cards).getByRole("listitem", { name: "Reykjavik" });
    expect(within(card).getByText("Northern lights")).toBeInTheDocument();
    expect(within(card).getByText("Iceland")).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Favorite Reykjavik" }));
    await waitFor(() => expect(sent).toEqual([{ favorite: true }]));

    await user.click(within(card).getByRole("button", { name: "Mark Reykjavik as visited" }));
    const dialog = await screen.findByRole("dialog", { name: "You made it to Reykjavik" });
    await user.click(within(dialog).getByRole("button", { name: "Mark as visited" }));

    expect(
      await screen.findByText("New country: Iceland. That’s 2 countries now."),
    ).toBeInTheDocument();
    expect(sent.at(-1)).toEqual({ status: "visited", visited_on: null });
    expect(await screen.findByRole("heading", { name: "Your list is empty" })).toBeInTheDocument();
  });

  it("deletes a place after confirming", async () => {
    const user = userEvent.setup();
    search = new URLSearchParams("view=visited");
    let deleted = false;
    const store = routes([place({ id: "p1", name: "Lisbon", country_code: "PT" })]);
    mockApi({
      ...session,
      ...store.route,
      [`DELETE ${PL}/items/p1`]: () => {
        deleted = true;
        store.set([]);
        return new Response(null, { status: 204 });
      },
    });

    await renderSignedIn(<PlacesPanel />);

    await user.click(await screen.findByRole("button", { name: "Actions for Lisbon" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Delete “Lisbon”?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("heading", { name: "Start your map" })).toBeInTheDocument();
    expect(deleted).toBe(true);
  });

  it("searches for a place online and pins it", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    const queries: unknown[] = [];
    const store = routes([], ONLINE);
    mockApi({
      ...session,
      ...store.route,
      [`POST ${PL}/search`]: (request: MockRequest) => {
        queries.push(request.body);
        return Response.json({
          matches: [
            {
              name: "Kyoto",
              locality: "Kyoto Prefecture",
              country_code: "JP",
              location: { latitude: 35.0116, longitude: 135.7681 },
              label: "Kyoto, Kyoto Prefecture, Japan",
            },
          ],
        });
      },
      [`POST ${PL}/items`]: (request: MockRequest) => {
        sent.push(request.body);
        const added = place({
          id: "p1",
          name: "Kyoto",
          country_code: "JP",
          location: { latitude: 35.0116, longitude: 135.7681 },
        });
        store.set([added]);
        return Response.json(added, { status: 201 });
      },
    });

    await renderSignedIn(<PlacesPanel />);

    await user.click((await screen.findAllByRole("button", { name: "Add a place" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Add a place" });
    await user.type(
      within(dialog).getByRole("searchbox", { name: "Find a place" }),
      "Kyoto{Enter}",
    );
    const results = await within(dialog).findByRole("list", { name: "Search results" });
    await user.click(within(results).getByRole("button", { name: /Kyoto/ }));

    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Kyoto");
    expect(within(dialog).getByRole("combobox", { name: "Country" })).toHaveTextContent("Japan");
    expect(within(dialog).getByText("Pinned on the map")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add place" }));

    expect(
      await screen.findByRole("img", { name: /World map with 1 country visited/ }),
    ).toHaveAttribute("data-style", "https://tiles.example/style");
    expect(queries).toEqual([{ query: "Kyoto" }]);
    expect(sent).toEqual([
      expect.objectContaining({
        name: "Kyoto",
        locality: "Kyoto Prefecture",
        country_code: "JP",
        location: { latitude: 35.0116, longitude: 135.7681 },
      }),
    ]);
  });

  it("shows a load error with a retry", async () => {
    mockApi({
      ...session,
      [`GET ${PL}/items`]: status(500),
      [`GET ${PL}/settings`]: json(OFFLINE),
    });

    await renderSignedIn(<PlacesPanel />);

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(retry.closest("[role='alert']")).toHaveTextContent(/\S/);
    expect(screen.queryByRole("img")).toBeNull();
  });
});
