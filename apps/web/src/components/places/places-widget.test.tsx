import type { Place } from "@orbit/contracts";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { PlacesWidget } from "./places-widget";

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
const ITEMS = `/api/v1/workspaces/${personal.id}/places/items`;

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

describe("PlacesWidget", () => {
  it("shows the tally and where to go next", async () => {
    mockApi({
      ...session,
      [`GET ${ITEMS}`]: json({
        places: [
          place({ id: "1", name: "Kyoto", country_code: "JP" }),
          place({ id: "2", name: "Lisbon", country_code: "PT" }),
          place({ id: "3", name: "Reykjavik", country_code: "IS", status: "want_to_visit" }),
        ],
      }),
    });

    await renderSignedIn(<PlacesWidget />);

    expect(await screen.findByRole("progressbar", { name: "Countries visited" })).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
    expect(screen.getByText("2 / 7")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Reykjavik, Iceland/ })).toHaveAttribute(
      "href",
      "/places?view=wishlist",
    );
  });

  it("invites a first place", async () => {
    mockApi({ ...session, [`GET ${ITEMS}`]: json({ places: [] }) });

    await renderSignedIn(<PlacesWidget />);

    expect(await screen.findByRole("link", { name: "Add a place" })).toHaveAttribute(
      "href",
      "/places",
    );
  });
});
