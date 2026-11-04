import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { FinanceSettings } from "./finance-settings";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/finance",
}));

const MARKET = `/api/v1/workspaces/${personal.id}/finance/market-data`;
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

describe("Finance settings", () => {
  it("turns live prices on for the workspace", async () => {
    const saved: MockRequest[] = [];
    mockApi({
      ...session,
      [`GET ${MARKET}`]: json({ available: true, enabled: false }),
      [`PUT ${MARKET}`]: (request: MockRequest) => {
        saved.push(request);
        return json({ available: true, enabled: true })(request);
      },
    });
    await renderSignedIn(<FinanceSettings />);

    const live = await screen.findByRole("switch", { name: "Live prices" });
    expect(live).toHaveAttribute("aria-checked", "false");
    expect(live).toHaveAccessibleDescription(/Only scheme codes and tickers are sent/);
    await userEvent.click(live);

    await waitFor(() => expect(live).toHaveAttribute("aria-checked", "true"));
    expect(saved[0]?.body).toEqual({ enabled: true });
  });

  it("can't be turned on when the server has it off", async () => {
    mockApi({ ...session, [`GET ${MARKET}`]: json({ available: false, enabled: false }) });
    await renderSignedIn(<FinanceSettings />);

    expect(await screen.findByRole("switch", { name: "Live prices" })).toBeDisabled();
    expect(screen.getByText("Turned off on this server.")).toBeVisible();
  });
});
