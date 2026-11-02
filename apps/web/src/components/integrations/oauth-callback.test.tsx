import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { connection } from "@/test/integrations";
import { renderSignedIn } from "@/test/session";

import { OAuthCallback } from "./oauth-callback";

const search = { params: new URLSearchParams() };
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/integrations/callback",
  useSearchParams: () => search.params,
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockReset();
});

describe("OAuthCallback", () => {
  it("completes once with the session, clears the address, and opens the connection", async () => {
    search.params = new URLSearchParams({ state: "s".repeat(43), code: "abc" });
    const history = vi.spyOn(window.history, "replaceState");
    const fetchMock = mockApi({
      ...session,
      "POST /api/v1/integrations/oauth/complete": json(connection()),
    });
    await renderSignedIn(<OAuthCallback />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/settings/integrations?connection=c1"),
    );
    expect(history).toHaveBeenCalledWith(null, "", "/integrations/callback");
    const completions = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/oauth/complete"),
    );
    expect(completions).toHaveLength(1);
    expect(JSON.parse(String(completions[0]?.[1]?.body))).toEqual({
      state: "s".repeat(43),
      code: "abc",
      error: null,
    });
  });

  it("explains a refused or expired authorization", async () => {
    search.params = new URLSearchParams({ state: "s".repeat(43), error: "access_denied" });
    mockApi({
      ...session,
      "POST /api/v1/integrations/oauth/complete": status(
        400,
        "Access wasn't granted, so nothing was connected.",
      ),
    });
    await renderSignedIn(<OAuthCallback />);
    expect(await screen.findByText("The account wasn’t connected")).toBeInTheDocument();
    expect(screen.getByText(/Access wasn't granted/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("does nothing without a state", async () => {
    search.params = new URLSearchParams();
    const fetchMock = mockApi(session);
    await renderSignedIn(<OAuthCallback />);
    expect(await screen.findByText(/only reached from a provider’s sign-in/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("oauth"))).toBe(false);
  });
});
