import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { SystemSettings } from "./system-settings";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/system",
  useSearchParams: () => new URLSearchParams(),
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

const off = {
  enabled: false,
  repository: "nithiin7/orbit-assistant",
  current_version: "1.0.0",
  latest_version: null,
  latest_published_at: null,
  update_available: false,
  release_url: null,
  checked_at: null,
  check_failed: false,
};

const newer = {
  ...off,
  enabled: true,
  latest_version: "1.2.0",
  update_available: true,
  release_url: "https://github.com/nithiin7/orbit-assistant/releases/tag/v1.2.0",
  checked_at: new Date().toISOString(),
};

const healthy = {
  version: "1.0.0",
  storage_mode: "local",
  started_at: new Date().toISOString(),
  database: { status: "ok", revision: "0055", expected_revision: "0055" },
  worker: { runs_in_api: true, status: "ok" },
  features: {
    ai: true,
    agent: true,
    web_push: true,
    google: false,
    microsoft: false,
    online_maps: true,
  },
};

describe("SystemSettings", () => {
  it("turns update checks on and shows a newer release", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    mockApi({
      ...session,
      "GET /api/v1/system/update": json(off),
      "GET /api/v1/system/status": json(healthy),
      "PUT /api/v1/system/settings": (request: MockRequest) => {
        sent.push(request.body);
        return Response.json(newer);
      },
    });

    await renderSignedIn(<SystemSettings />);

    expect(await screen.findByText("Update checks are off")).toBeInTheDocument();
    expect(screen.getByText(/GitHub sees the server’s address/)).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Check for updates" }));

    await waitFor(() => expect(sent).toEqual([{ update_check_enabled: true }]));
    expect(await screen.findByText("Orbit 1.2.0 is available")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /What’s new/ })).toHaveAttribute(
      "href",
      newer.release_url,
    );
    expect(screen.getByRole("link", { name: /How to upgrade/ })).toHaveAttribute(
      "href",
      "https://github.com/nithiin7/orbit-assistant/blob/main/docs/deployment.md#upgrading",
    );
  });

  it("checks now on request", async () => {
    const user = userEvent.setup();
    let checks = 0;
    mockApi({
      ...session,
      "GET /api/v1/system/update": json({
        ...newer,
        latest_version: "1.0.0",
        update_available: false,
        release_url: null,
      }),
      "GET /api/v1/system/status": json(healthy),
      "POST /api/v1/system/update/check": () => {
        checks += 1;
        return Response.json(newer);
      },
    });

    await renderSignedIn(<SystemSettings />);

    expect(await screen.findByText("You’re up to date")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText("Orbit 1.2.0 is available")).toBeInTheDocument();
    expect(checks).toBe(1);
  });

  it("lists the server's health and configured features", async () => {
    mockApi({
      ...session,
      "GET /api/v1/system/update": json(off),
      "GET /api/v1/system/status": json(healthy),
    });

    await renderSignedIn(<SystemSettings />);

    expect(await screen.findByText("Orbit 1.0.0")).toBeInTheDocument();
    expect(screen.getByText("Local (SQLite)")).toBeInTheDocument();
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    expect(screen.getByText("Delivering reminders")).toBeInTheDocument();
    const features = screen.getByRole("list", { name: "Optional features" });
    expect(within(features).getByText(/Google/)).toHaveTextContent("Google: not configured");
    expect(within(features).getByText(/^AI/)).toHaveTextContent("AI: configured");
  });

  it("says what to do when the schema is old or reminders are waiting", async () => {
    mockApi({
      ...session,
      "GET /api/v1/system/update": json(off),
      "GET /api/v1/system/status": json({
        ...healthy,
        database: { status: "outdated", revision: "0050", expected_revision: "0055" },
        worker: { runs_in_api: false, status: "behind" },
      }),
    });

    await renderSignedIn(<SystemSettings />);

    expect(await screen.findByText("Needs migrating")).toBeInTheDocument();
    expect(screen.getByText(/At revision 0050; this version expects 0055/)).toBeInTheDocument();
    expect(screen.getByText("Reminders are waiting")).toBeInTheDocument();
    expect(screen.getByText("uv run orbit-worker")).toBeInTheDocument();
  });

  it("says so when the status can't load", async () => {
    mockApi({
      ...session,
      "GET /api/v1/system/update": status(500),
      "GET /api/v1/system/status": status(500),
    });

    await renderSignedIn(<SystemSettings />);

    expect(await screen.findByText("Couldn’t load the update status.")).toBeInTheDocument();
    expect(screen.getByText("Couldn’t load the server’s status.")).toBeInTheDocument();
  });
});
