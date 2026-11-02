import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { INTEGRATIONS } from "@/test/integrations";
import { renderSignedIn } from "@/test/session";

import { ExternalOrigin } from "./external-origin";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/calendar",
  useSearchParams: () => new URLSearchParams(),
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

const link = {
  id: "l1",
  connection_id: "c1",
  external_kind: "event",
  external_id: "e1",
  entity_type: "event",
  entity_id: "ev1",
  origin: "external",
  title: "Standup",
  external_url: "https://calendar.google.com/event?eid=x",
  status: "synced",
  conflict_kind: null,
  conflict_detected_at: null,
  last_synced_at: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExternalOrigin", () => {
  it("says where an event came from and whether changes go back", async () => {
    mockApi({
      ...session,
      [`GET ${INTEGRATIONS}/origins`]: json({
        origins: [
          {
            link,
            provider: "google",
            account_email: "ada@gmail.example",
            resource_name: "Personal",
            two_way: false,
          },
        ],
      }),
    });
    await renderSignedIn(<ExternalOrigin entityType="event" entityId="ev1" />);
    expect(await screen.findByRole("link", { name: "Google Calendar" })).toHaveAttribute(
      "href",
      "/settings/integrations?connection=c1",
    );
    expect(screen.getByText(/ada@gmail\.example · Personal/)).toHaveTextContent(
      "Changes made here stay in Orbit.",
    );
    expect(screen.getByRole("link", { name: "Open there" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });

  it("renders nothing for Orbit-only records", async () => {
    mockApi({ ...session, [`GET ${INTEGRATIONS}/origins`]: json({ origins: [] }) });
    await renderSignedIn(<ExternalOrigin entityType="document" entityId="d1" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
