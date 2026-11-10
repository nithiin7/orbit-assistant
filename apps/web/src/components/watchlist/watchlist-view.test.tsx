import type { TitleMatch, WatchItem, WatchlistLookup } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { WatchlistPanel } from "./watchlist-view";

// The view comes from the URL; each test picks its own.
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/watchlist",
  useSearchParams: () => search,
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};
const WL = `/api/v1/workspaces/${personal.id}/watchlist`;

function title(overrides: Partial<WatchItem> & Pick<WatchItem, "id" | "title">): WatchItem {
  return {
    workspace_id: personal.id,
    kind: "movie",
    release_year: null,
    overview: "",
    genres: [],
    runtime_minutes: null,
    season_episodes: null,
    status: "want",
    progress: null,
    rating: null,
    notes: "",
    platform: null,
    recommended_by: null,
    looked_up: false,
    has_poster: false,
    position: 0,
    started_at: null,
    finished_at: null,
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    ...overrides,
  } satisfies WatchItem;
}

function lookup(value: WatchlistLookup) {
  return { [`GET ${WL}/lookup`]: json(value) };
}

/** A stateful items list, so mutations that refetch see their changes. */
function itemsRoute(initial: WatchItem[]) {
  let items = initial;
  return {
    get: () => items,
    set: (next: WatchItem[]) => {
      items = next;
    },
    route: { [`GET ${WL}/items`]: () => Response.json({ items }) },
  };
}

afterEach(() => {
  search = new URLSearchParams();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("WatchlistPanel", () => {
  it("adds a first title by hand when lookup isn't set up", async () => {
    const user = userEvent.setup();
    const store = itemsRoute([]);
    const added: unknown[] = [];
    mockApi({
      ...session,
      ...store.route,
      ...lookup({ configured: false, enabled: false }),
      [`POST ${WL}/items`]: (request: MockRequest) => {
        added.push(request.body);
        const item = title({ id: "t-arrival", title: "Arrival", release_year: 2016 });
        store.set([item]);
        return Response.json(item, { status: 201 });
      },
    });

    await renderSignedIn(<WatchlistPanel />);

    await user.click(await screen.findByRole("button", { name: "Add your first title" }));
    const dialog = await screen.findByRole("dialog", { name: "Add to watchlist" });
    expect(
      within(dialog).getByRole("link", { name: /Get posters and details automatically/ }),
    ).toHaveAttribute("href", "/settings/watchlist");
    await user.type(within(dialog).getByRole("textbox", { name: "Title" }), "Arrival");
    await user.type(within(dialog).getByRole("textbox", { name: "Year" }), "2016");
    await user.click(within(dialog).getByRole("button", { name: "Add to watchlist" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(added).toEqual([
      {
        kind: "movie",
        title: "Arrival",
        release_year: 2016,
        platform: null,
        status: "want",
        notes: "",
      },
    ]);
    const queue = await screen.findByRole("list", { name: "Next in your queue" });
    expect(within(queue).getByRole("button", { name: /^Arrival/ })).toBeInTheDocument();
    expect(within(queue).getByText("Up next")).toBeInTheDocument();
  });

  it("searches TMDB and adds the highlighted match with Enter", async () => {
    const user = userEvent.setup();
    const store = itemsRoute([title({ id: "t-old", title: "Old favorite" })]);
    const dune: TitleMatch = {
      source_id: 438631,
      kind: "movie",
      title: "Dune",
      release_year: 2021,
      overview: "Spice.",
      poster_path: null,
      existing_id: null,
    };
    const added: unknown[] = [];
    mockApi({
      ...session,
      ...store.route,
      ...lookup({ configured: true, enabled: true }),
      [`GET ${WL}/search`]: json({ results: [dune] }),
      [`POST ${WL}/items`]: (request: MockRequest) => {
        added.push(request.body);
        const item = title({ id: "t-dune", title: "Dune", looked_up: true, position: 1 });
        store.set([...store.get(), item]);
        return Response.json(item, { status: 201 });
      },
    });

    await renderSignedIn(<WatchlistPanel />);
    await user.click(await screen.findByRole("button", { name: "Add title" }));
    const dialog = await screen.findByRole("dialog", { name: "Add to watchlist" });
    await user.click(within(dialog).getByRole("radio", { name: "Watched" }));
    await user.type(
      within(dialog).getByRole("combobox", { name: "Search movies and series" }),
      "dune",
    );

    const option = await within(dialog).findByRole("option", { name: /Dune/ });
    expect(option).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(within(dialog).getByRole("option", { name: /Dune/ })).toHaveTextContent("Added"),
    );
    expect(added).toEqual([{ kind: "movie", source_id: 438631, status: "watched", notes: "" }]);
    expect(within(dialog).getByText(/not endorsed or certified by TMDB/)).toBeInTheDocument();
  });

  it("logs episodes from Continue watching and cheers the finale", async () => {
    const user = userEvent.setup();
    const saga = title({
      id: "t-saga",
      title: "Saga",
      kind: "series",
      status: "watching",
      season_episodes: [2, 1],
      progress: { season: 1, episode: 2 },
      started_at: "2026-11-01T09:00:00Z",
    });
    const store = itemsRoute([saga]);
    mockApi({
      ...session,
      ...store.route,
      ...lookup({ configured: false, enabled: false }),
      [`POST ${WL}/items/${saga.id}/next-episode`]: json({
        ...saga,
        status: "watched",
        progress: { season: 2, episode: 1 },
        finished_at: "2026-11-10T20:00:00Z",
      }),
    });

    await renderSignedIn(<WatchlistPanel />);

    const shelf = await screen.findByRole("region", { name: "Continue watching" });
    expect(within(shelf).getByText("Watched S1 · E2")).toBeInTheDocument();
    expect(within(shelf).getByRole("progressbar", { name: "Saga progress" })).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
    await user.click(within(shelf).getByRole("button", { name: "Watched S2 · E1 of Saga" }));

    expect(await screen.findByText("Finished Saga")).toBeInTheDocument();
    await waitFor(() => expect(shelf).toHaveTextContent("Nothing in progress"));
  });

  it("rates a title from its sheet and removes it after confirming", async () => {
    const user = userEvent.setup();
    const arrival = title({
      id: "t-arrival",
      title: "Arrival",
      status: "watched",
      finished_at: "2026-11-02T21:00:00Z",
      started_at: "2026-11-02T19:00:00Z",
    });
    const store = itemsRoute([arrival]);
    const patches: unknown[] = [];
    mockApi({
      ...session,
      ...store.route,
      ...lookup({ configured: false, enabled: false }),
      [`PATCH ${WL}/items/${arrival.id}`]: (request: MockRequest) => {
        patches.push(request.body);
        return Response.json({ ...arrival, rating: 9, updated_at: "2026-11-10T10:00:00Z" });
      },
      [`DELETE ${WL}/items/${arrival.id}`]: () => {
        store.set([]);
        return new Response(null, { status: 204 });
      },
    });

    search = new URLSearchParams("view=watched");
    await renderSignedIn(<WatchlistPanel />);
    await screen.findByRole("button", { name: /^Arrival/ });
    const nav = screen.getByRole("navigation", { name: "Watchlist views" });
    expect(within(nav).getByRole("link", { name: /Watched\s*1/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: /Want to watch\s*0/ })).toHaveAttribute(
      "href",
      "/watchlist?view=want",
    );
    await user.click(await screen.findByRole("button", { name: /^Arrival/ }));

    const sheet = await screen.findByRole("dialog", { name: "Arrival" });
    await user.click(within(sheet).getByRole("radio", { name: "4.5 stars" }));
    await waitFor(() => expect(patches).toEqual([{ rating: 9 }]));
    expect(await within(sheet).findByRole("radio", { name: "4.5 stars" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await user.click(within(sheet).getByRole("button", { name: "Remove" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Remove “Arrival”?" });
    await user.click(within(confirm).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Arrival" })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText("Start your watchlist")).toBeInTheDocument();
  });

  it("turns a search with no match into a title entered by hand", async () => {
    const user = userEvent.setup();
    const store = itemsRoute([title({ id: "t-old", title: "Old favorite" })]);
    const added: unknown[] = [];
    mockApi({
      ...session,
      ...store.route,
      ...lookup({ configured: true, enabled: true }),
      [`GET ${WL}/search`]: json({ results: [] }),
      [`POST ${WL}/items`]: (request: MockRequest) => {
        added.push(request.body);
        return Response.json(title({ id: "t-home", title: "Home movie" }), { status: 201 });
      },
    });

    await renderSignedIn(<WatchlistPanel />);
    await user.click(await screen.findByRole("button", { name: "Add title" }));
    const dialog = await screen.findByRole("dialog", { name: "Add to watchlist" });
    await user.type(
      within(dialog).getByRole("combobox", { name: "Search movies and series" }),
      "Home movie",
    );
    expect(await within(dialog).findByText("No matches for “Home movie”.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /Add “Home movie” by hand/ }));

    expect(within(dialog).getByRole("textbox", { name: "Title" })).toHaveValue("Home movie");
    await user.click(within(dialog).getByRole("radio", { name: "Series" }));
    await user.click(within(dialog).getByRole("button", { name: "Add to watchlist" }));

    await waitFor(() =>
      expect(added).toEqual([
        {
          kind: "series",
          title: "Home movie",
          release_year: null,
          platform: null,
          status: "want",
          notes: "",
        },
      ]),
    );
  });

  it("opens a title linked from search", async () => {
    const arrival = title({ id: "t-arrival", title: "Arrival", overview: "Linguists and aliens." });
    mockApi({
      ...session,
      ...itemsRoute([arrival]).route,
      ...lookup({ configured: false, enabled: false }),
    });

    search = new URLSearchParams("title=t-arrival");
    await renderSignedIn(<WatchlistPanel />);

    const sheet = await screen.findByRole("dialog", { name: "Arrival" });
    expect(within(sheet).getByText("Linguists and aliens.")).toBeInTheDocument();
  });

  it("shows an error with a retry when the watchlist can't load", async () => {
    mockApi({
      ...session,
      ...lookup({ configured: false, enabled: false }),
      [`GET ${WL}/items`]: status(500, "Something went wrong."),
    });

    await renderSignedIn(<WatchlistPanel />);

    const message = await screen.findByText("Something went wrong.");
    const alert = message.closest('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(
      within(alert as HTMLElement).getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});
