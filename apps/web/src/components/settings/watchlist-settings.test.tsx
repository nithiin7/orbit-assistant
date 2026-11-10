import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { WatchlistSettings } from "./watchlist-settings";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/watchlist",
}));

const LOOKUP = `/api/v1/workspaces/${personal.id}/watchlist/lookup`;
const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Watchlist settings", () => {
  it("saves a TMDB key, which turns lookup on", async () => {
    const user = userEvent.setup();
    const saved: unknown[] = [];
    mockApi({
      ...session,
      [`GET ${LOOKUP}`]: json({ configured: false, enabled: false }),
      [`PUT ${LOOKUP}/key`]: (request: MockRequest) => {
        saved.push(request.body);
        return Response.json({ configured: true, enabled: true });
      },
    });
    await renderSignedIn(<WatchlistSettings />);

    const key = await screen.findByLabelText("TMDB key");
    expect(key).toHaveAttribute("type", "password");
    expect(screen.getByRole("link", { name: /Settings → API/ })).toHaveAttribute(
      "href",
      "https://www.themoviedb.org/settings/api",
    );
    await user.type(key, "  my-tmdb-token-1234567890  ");
    await user.click(screen.getByRole("button", { name: "Save key" }));

    expect(await screen.findByText("TMDB key saved")).toBeInTheDocument();
    expect(saved).toEqual([{ api_key: "my-tmdb-token-1234567890" }]);
    expect(screen.getByRole("switch", { name: "Look up titles" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("shows TMDB's refusal and keeps the form", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      [`GET ${LOOKUP}`]: json({ configured: false, enabled: false }),
      [`PUT ${LOOKUP}/key`]: status(
        422,
        "TMDB didn't accept this API key. Check it and try again.",
      ),
    });
    await renderSignedIn(<WatchlistSettings />);

    await user.type(await screen.findByLabelText("TMDB key"), "wrong-key-1234567890");
    await user.click(screen.getByRole("button", { name: "Save key" }));

    expect(await screen.findByText(/TMDB didn't accept this API key/)).toBeInTheDocument();
    expect(screen.getByLabelText("TMDB key")).toBeInTheDocument();
  });

  it("pauses lookup and removes the key after confirming", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    mockApi({
      ...session,
      [`GET ${LOOKUP}`]: json({ configured: true, enabled: true }),
      [`PUT ${LOOKUP}`]: (request: MockRequest) => {
        calls.push(`PUT ${JSON.stringify(request.body)}`);
        return Response.json({ configured: true, enabled: false });
      },
      [`DELETE ${LOOKUP}/key`]: () => {
        calls.push("DELETE");
        return Response.json({ configured: false, enabled: false });
      },
    });
    await renderSignedIn(<WatchlistSettings />);

    await user.click(await screen.findByRole("switch", { name: "Look up titles" }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Look up titles" })).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );

    await user.click(screen.getByRole("button", { name: "Remove" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Remove the TMDB key?" });
    await user.click(within(confirm).getByRole("button", { name: "Remove key" }));

    expect(await screen.findByLabelText("TMDB key")).toBeInTheDocument();
    expect(calls).toEqual(['PUT {"enabled":false}', "DELETE"]);
  });
});
