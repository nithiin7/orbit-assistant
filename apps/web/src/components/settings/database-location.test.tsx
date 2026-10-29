import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { DatabaseLocation } from "./database-location";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/storage",
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: true }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};
const PATH = "/Users/ada/orbit/apps/api/.data/orbit.sqlite3";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("DatabaseLocation", () => {
  it("shows the database path and asks the API to open its folder", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      "GET /api/v1/storage": json({ storage_mode: "local", database_path: PATH, can_reveal: true }),
      "POST /api/v1/storage/reveal": status(204),
    });
    await renderSignedIn(<DatabaseLocation />);

    expect(await screen.findByText(PATH)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Show in|Open folder/ }));

    expect(
      await screen.findByText("Opened on the computer running the Orbit API."),
    ).toBeInTheDocument();
    expect(api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("reports when no file manager could be opened", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      "GET /api/v1/storage": json({ storage_mode: "local", database_path: PATH, can_reveal: true }),
      "POST /api/v1/storage/reveal": status(
        503,
        "Could not open a file manager on the machine running the Orbit API.",
      ),
    });
    await renderSignedIn(<DatabaseLocation />);

    await user.click(await screen.findByRole("button", { name: /Show in|Open folder/ }));

    const message = await screen.findByText(/Could not open a file manager/);
    expect(message.closest("[role=alert]")).not.toBeNull();
  });

  it("renders nothing when the API doesn't share the location", async () => {
    mockApi({
      ...session,
      "GET /api/v1/storage": json({
        storage_mode: "cloud",
        database_path: null,
        can_reveal: false,
      }),
    });
    await renderSignedIn(<DatabaseLocation />);

    await vi.waitFor(() => expect(screen.queryByText(/Loading the database/)).toBeNull());
    expect(screen.queryByRole("heading", { name: "Database file" })).toBeNull();
  });
});
