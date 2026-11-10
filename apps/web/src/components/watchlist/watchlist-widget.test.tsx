import type { WatchItem } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { WatchlistWidget } from "./watchlist-widget";

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

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("WatchlistWidget", () => {
  it("logs the next episode and shows what's up next", async () => {
    const user = userEvent.setup();
    const saga = title({
      id: "t-saga",
      title: "Saga",
      kind: "series",
      status: "watching",
      season_episodes: [3],
      progress: { season: 1, episode: 1 },
    });
    const logged: string[] = [];
    mockApi({
      ...session,
      [`GET ${WL}/items`]: json({
        items: [saga, title({ id: "t-dune", title: "Dune", position: 1 })],
      }),
      [`POST ${WL}/items/${saga.id}/next-episode`]: () => {
        logged.push(saga.id);
        return Response.json({ ...saga, progress: { season: 1, episode: 2 } });
      },
    });

    await renderSignedIn(<WatchlistWidget />);

    const watching = await screen.findByRole("list", { name: "Watching" });
    expect(within(watching).getByText("Watched S1 · E1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Up next\s*Dune/ })).toHaveAttribute(
      "href",
      "/watchlist?view=want",
    );

    await user.click(screen.getByRole("button", { name: "Watched S1 · E2 of Saga" }));
    await waitFor(() => expect(logged).toEqual(["t-saga"]));
    expect(await within(watching).findByText("Watched S1 · E2")).toBeInTheDocument();
  });

  it("invites a first title when the watchlist is empty", async () => {
    mockApi({ ...session, [`GET ${WL}/items`]: json({ items: [] }) });

    await renderSignedIn(<WatchlistWidget />);

    expect(await screen.findByRole("link", { name: "Add a title" })).toHaveAttribute(
      "href",
      "/watchlist",
    );
  });
});
