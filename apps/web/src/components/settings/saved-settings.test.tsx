import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { SavedSettings } from "./saved-settings";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/saved",
  useSearchParams: () => new URLSearchParams(),
}));

const SETTINGS = `/api/v1/workspaces/${personal.id}/bookmarks/settings`;
const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

describe("SavedSettings", () => {
  it("turns link previews on, explaining what that sends", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    mockApi({
      ...session,
      [`GET ${SETTINGS}`]: json({ previews_enabled: false }),
      [`PUT ${SETTINGS}`]: (request: MockRequest) => {
        sent.push(request.body);
        return Response.json({ previews_enabled: true });
      },
    });

    await renderSignedIn(<SavedSettings />);

    const toggle = await screen.findByRole("switch", { name: "Fetch link previews" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/never your local network/)).toBeInTheDocument();
    await user.click(toggle);

    await waitFor(() => expect(sent).toEqual([{ previews_enabled: true }]));
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("says so when the settings can't load", async () => {
    mockApi({ ...session, [`GET ${SETTINGS}`]: status(500) });

    await renderSignedIn(<SavedSettings />);

    expect(
      await screen.findByText("Couldn’t load Saved settings. Refresh to try again."),
    ).toBeInTheDocument();
  });
});
