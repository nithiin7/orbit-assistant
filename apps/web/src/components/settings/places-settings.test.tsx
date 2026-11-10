import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { PlacesSettings } from "./places-settings";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/places",
  useSearchParams: () => new URLSearchParams(),
}));

const SETTINGS = `/api/v1/workspaces/${personal.id}/places/settings`;
const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

describe("PlacesSettings", () => {
  it("turns online maps on, explaining what that shares", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    mockApi({
      ...session,
      [`GET ${SETTINGS}`]: json({
        online_maps: false,
        online_maps_allowed: true,
        map_style_url: null,
      }),
      [`PUT ${SETTINGS}`]: (request: MockRequest) => {
        sent.push(request.body);
        return Response.json({
          online_maps: true,
          online_maps_allowed: true,
          map_style_url: "https://tiles.example/style",
        });
      },
    });

    await renderSignedIn(<PlacesSettings />);

    const toggle = await screen.findByRole("switch", { name: "Use online maps and place search" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/Your saved places never leave Orbit/)).toBeInTheDocument();
    await user.click(toggle);

    await waitFor(() => expect(sent).toEqual([{ online_maps: true }]));
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("can't be turned on when the server keeps maps offline", async () => {
    mockApi({
      ...session,
      [`GET ${SETTINGS}`]: json({
        online_maps: false,
        online_maps_allowed: false,
        map_style_url: null,
      }),
    });

    await renderSignedIn(<PlacesSettings />);

    expect(
      await screen.findByRole("switch", { name: "Use online maps and place search" }),
    ).toBeDisabled();
    expect(screen.getByText("This Orbit server keeps maps offline.")).toBeInTheDocument();
  });
});
