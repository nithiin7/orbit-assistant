import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import {
  calendar,
  connection,
  detail,
  google,
  INTEGRATIONS,
  microsoft,
  run,
} from "@/test/integrations";
import { renderSignedIn } from "@/test/session";

import { IntegrationsSettings } from "./integrations-settings";

const search = { params: new URLSearchParams() };
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push }),
  usePathname: () => "/settings/integrations",
  useSearchParams: () => search.params,
}));

const WS = `/api/v1/workspaces/${personal.id}`;

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
  [`GET ${INTEGRATIONS}/providers`]: json({ providers: [google, microsoft], webhooks: false }),
  [`GET ${INTEGRATIONS}/conflicts`]: json({ conflicts: [] }),
  [`GET ${WS}/calendar/categories`]: json({ categories: [] }),
};

beforeEach(() => {
  search.params = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("Integrations overview", () => {
  it("lists connected accounts with their services and status", async () => {
    mockApi({
      ...session,
      [`GET ${INTEGRATIONS}/connections`]: json({
        connections: [connection({ status: "reauth_required" })],
      }),
    });
    await renderSignedIn(<IntegrationsSettings />);
    const link = await screen.findByRole("link", { name: /ada@gmail\.example/ });
    expect(link).toHaveAttribute("href", "/settings/integrations?connection=c1");
    expect(within(link).getByText("Needs reconnecting")).toBeInTheDocument();
    expect(within(link).getByText(/Google Calendar · Gmail · Google Drive/)).toBeInTheDocument();
    expect(screen.getByText(/Tokens stay encrypted on the server/)).toBeInTheDocument();
  });

  it("connects with only the chosen permissions and goes to the provider", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const fetchMock = mockApi({
      ...session,
      [`GET ${INTEGRATIONS}/connections`]: json({ connections: [] }),
      [`POST ${INTEGRATIONS}/authorize`]: json({
        authorization_url: "https://accounts.google.example/auth?state=x",
      }),
    });
    await renderSignedIn(<IntegrationsSettings />);
    expect(await screen.findByText(/No accounts connected yet/)).toBeInTheDocument();
    // Read-only calendars are the default; mail needs opting in.
    expect(screen.getByRole("checkbox", { name: "Google Calendar" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Gmail" })).not.toBeChecked();
    // Allowing edits also needs reading.
    await user.click(screen.getByRole("checkbox", { name: "Google Calendar" }));
    await user.click(screen.getByRole("checkbox", { name: "Edit Google Calendar events" }));
    expect(screen.getByRole("checkbox", { name: "Google Calendar" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Continue to Google" }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://accounts.google.example/auth?state=x"),
    );
    const authorize = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/authorize"));
    expect(JSON.parse(String(authorize?.[1]?.body))).toEqual({
      provider: "google",
      capabilities: ["calendar", "calendar_write"],
      connection_id: null,
    });
    // An unconfigured provider says so instead of offering to connect.
    expect(screen.getByText(/Not set up on this Orbit server/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue to Microsoft" })).not.toBeInTheDocument();
  });

  it("guides the choice and marks unconfigured providers as unavailable", async () => {
    const user = userEvent.setup();
    mockApi({ ...session, [`GET ${INTEGRATIONS}/connections`]: json({ connections: [] }) });
    await renderSignedIn(<IntegrationsSettings />);
    const google = await screen.findByRole("group", { name: "Google: what Orbit may access" });
    expect(within(google).getByText(/Google will ask you to sign in/)).toBeInTheDocument();

    // With nothing chosen, there's nothing to continue with, and the card says why.
    await user.click(within(google).getByRole("checkbox", { name: "Google Calendar" }));
    expect(within(google).getByRole("button", { name: "Continue to Google" })).toBeDisabled();
    expect(within(google).getByText("Choose at least one thing Orbit may access.")).toBeVisible();

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Outlook Calendar · Outlook Mail · OneDrive")).toBeInTheDocument();
  });

  it("shows server errors when connecting can't start", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      [`GET ${INTEGRATIONS}/connections`]: json({ connections: [] }),
      [`POST ${INTEGRATIONS}/authorize`]: status(
        409,
        "This server can't store account tokens securely.",
      ),
    });
    await renderSignedIn(<IntegrationsSettings />);
    await user.click(await screen.findByRole("button", { name: "Continue to Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("can't store account tokens");
  });

  it("lets people resolve conflicts", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...session,
      [`GET ${INTEGRATIONS}/connections`]: json({ connections: [connection()] }),
      [`GET ${INTEGRATIONS}/conflicts`]: json({
        conflicts: [
          {
            link: {
              id: "l1",
              connection_id: "c1",
              external_kind: "event",
              external_id: "e1",
              entity_type: "event",
              entity_id: "ev1",
              origin: "external",
              title: "Standup",
              external_url: null,
              status: "conflict",
              conflict_kind: "both_changed",
              conflict_detected_at: "2030-01-01T00:00:00Z",
              last_synced_at: null,
            },
            provider: "google",
            account_email: "ada@gmail.example",
            external: {
              title: "Standup (moved)",
              start: "2030-01-14T10:00",
              end: "2030-01-14T10:30",
              all_day: false,
              location: "",
            },
          },
        ],
      }),
      [`POST ${INTEGRATIONS}/conflicts/l1/resolve`]: json({ link: null }),
    });
    await renderSignedIn(<IntegrationsSettings />);
    expect(await screen.findByText("1 event needs your choice")).toBeInTheDocument();
    expect(screen.getByText(/Standup \(moved\) · 2030-01-14 10:00/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use Google’s version" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/conflicts/l1/resolve") &&
            String(init?.body).includes("keep_external"),
        ),
      ).toBe(true),
    );
  });
});

describe("A connection's page", () => {
  beforeEach(() => {
    search.params = new URLSearchParams({ connection: "c1" });
  });

  const routes = (overrides = {}) => ({
    ...session,
    [`GET ${INTEGRATIONS}/connections/c1`]: json(
      detail({
        connection: connection({ capabilities: ["calendar"] }),
        runs: [
          run(),
          run({ id: "run2", status: "failed", imported: 0, error: "The provider is unavailable." }),
        ],
        ...overrides,
      }),
    ),
  });

  it("links each service to where it lives in Orbit", async () => {
    mockApi({
      ...routes({ connection: connection() }),
      [`GET ${INTEGRATIONS}/connections/c1/mail/labels`]: json({ labels: [] }),
    });
    await renderSignedIn(<IntegrationsSettings />);
    const services = await screen.findByRole("region", { name: "Services" });
    expect(within(services).getByRole("link", { name: /Open inbox/ })).toHaveAttribute(
      "href",
      "/tasks?inbox=c1",
    );
    expect(within(services).getByRole("link", { name: /Browse in Documents/ })).toHaveAttribute(
      "href",
      "/documents?drive=c1",
    );
    // Mail settings stay here; the messages themselves open beside Tasks.
    expect(screen.getByRole("heading", { name: "Gmail settings" })).toBeInTheDocument();
  });

  it("shows calendars, activity, and permissions", async () => {
    mockApi(routes());
    await renderSignedIn(<IntegrationsSettings />);
    expect(await screen.findByRole("heading", { name: "ada@gmail.example" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Personal/ })).not.toBeChecked();
    expect(screen.getByText(/3 added/)).toBeInTheDocument();
    expect(screen.getByText("The provider is unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What Orbit can access" })).toBeInTheDocument();
    // No mail or files section without those permissions.
    expect(screen.queryByRole("heading", { name: "Gmail" })).not.toBeInTheDocument();
  });

  it("selects a calendar to synchronize", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...routes(),
      [`PATCH ${INTEGRATIONS}/connections/c1/calendars/r1`]: json(calendar({ enabled: true })),
    });
    await renderSignedIn(<IntegrationsSettings />);
    await user.click(await screen.findByRole("switch", { name: /Personal/ }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
        enabled: true,
        clear_category: false,
      });
    });
  });

  it("explains that import-only calendars keep Orbit's edits", async () => {
    mockApi(routes({ resources: [calendar({ enabled: true, writable: false })] }));
    await renderSignedIn(<IntegrationsSettings />);
    expect(await screen.findByText("Read only")).toBeInTheDocument();
    expect(
      screen.getByText(/Edits you make in Orbit stay in Orbit\. To send them back, reconnect/),
    ).toBeInTheDocument();
  });

  it("warns when the account must be reconnected", async () => {
    mockApi(routes({ connection: connection({ status: "reauth_required" }) }));
    await renderSignedIn(<IntegrationsSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Orbit lost access to this account");
    expect(screen.getByRole("button", { name: /Sync now/ })).toBeDisabled();
  });

  it("disconnects after confirming, optionally removing imported records", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...routes(),
      [`DELETE ${INTEGRATIONS}/connections/c1`]: json({
        revoked: true,
        removed_events: 2,
        trashed_documents: 0,
      }),
      [`GET ${INTEGRATIONS}/connections`]: json({ connections: [] }),
    });
    await renderSignedIn(<IntegrationsSettings />);
    await user.click(await screen.findByRole("checkbox", { name: /Also remove the events/ }));
    await user.click(screen.getByRole("button", { name: "Disconnect account" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("revokes its access at Google");
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/settings/integrations"));
    const removal = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(String(removal?.[0])).toContain("remove_imported=true");
  });
});
