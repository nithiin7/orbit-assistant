import type { UserProfile } from "@orbit/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { connection, google, microsoft } from "@/test/integrations";
import { renderSignedIn } from "@/test/session";

import { SetupCard } from "./setup-card";
import { SetupGuide } from "./setup-guide";
import { SetupRedirect } from "./setup-redirect";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const search = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/welcome",
  useSearchParams: () => search.params,
}));

/** The API's session routes for `user`, recording every profile change. */
function session(user: UserProfile, patches: MockRequest[]) {
  let current = user;
  return {
    "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
    "GET /api/v1/me": () => Response.json(current),
    "PATCH /api/v1/me": (request: MockRequest) => {
      patches.push(request);
      current = { ...current, ...(request.body as Partial<UserProfile>) };
      return Response.json(current);
    },
    "GET /api/v1/me/avatar": status(204),
    "GET /api/v1/workspaces": json({ workspaces: [personal] }),
  };
}

beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
  search.params = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Setup guide", () => {
  it("walks a new user through the basics and finishes", async () => {
    const patches: MockRequest[] = [];
    mockApi(session({ ...ada, setup_status: "pending" }, patches));
    await renderSignedIn(<SetupGuide />);

    // Opening the guide stops the automatic redirect.
    await waitFor(() => expect(patches[0]?.body).toEqual({ setup_status: "deferred" }));
    expect(await screen.findByRole("heading", { name: "Welcome to Orbit" })).toHaveFocus();
    expect(screen.getByText("Step 1 of 8")).toBeVisible();

    const name = screen.getByRole("textbox", { name: "What should we call you?" });
    await userEvent.clear(name);
    await userEvent.type(name, "Countess");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Make it feel right" })).toBeVisible();
    expect(patches[1]?.body).toEqual({ display_name: "Countess" });
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Choosing nothing to set up goes straight to the end.
    expect(
      await screen.findByRole("heading", { name: "What would you like to set up?" }),
    ).toBeVisible();
    for (const area of ["Money", "Health", "Google or Microsoft", "AI assistant"]) {
      await userEvent.click(screen.getByRole("checkbox", { name: new RegExp(area) }));
    }
    expect(screen.getByText("Step 3 of 4")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "You’re all set" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Go to the dashboard" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    expect(patches.at(-1)?.body).toEqual({ setup_status: "done" });
  });

  it("can be left for later from any step", async () => {
    const patches: MockRequest[] = [];
    mockApi(session({ ...ada, setup_status: "pending" }, patches));
    await renderSignedIn(<SetupGuide />);

    await waitFor(() => expect(patches).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: "Finish later" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    expect(patches).toEqual([expect.objectContaining({ body: { setup_status: "deferred" } })]);
  });

  it("keeps a finished setup finished when run again", async () => {
    const patches: MockRequest[] = [];
    mockApi(session(ada, patches));
    await renderSignedIn(<SetupGuide />);

    await userEvent.click(await screen.findByRole("button", { name: "Finish later" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    expect(patches).toEqual([]);
  });

  it("opens at the connect step after a provider's consent page", async () => {
    search.params = new URLSearchParams("step=connect");
    mockApi({
      ...session(ada, []),
      [`GET /api/v1/workspaces/${personal.id}/integrations/providers`]: json({
        providers: [
          { provider: "google", configured: false, capabilities: [] },
          { provider: "microsoft", configured: false, capabilities: [] },
        ],
        webhooks: false,
      }),
      [`GET /api/v1/workspaces/${personal.id}/integrations/connections`]: json({ connections: [] }),
    });
    await renderSignedIn(<SetupGuide />);

    expect(await screen.findByRole("heading", { name: "Connect your accounts" })).toBeVisible();
    expect(await screen.findByText("Not set up on this Orbit server yet")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("heading", { name: "Set up the AI assistant" })).toBeVisible();
  });

  it("lists connected accounts and offers another only on request", async () => {
    search.params = new URLSearchParams("step=connect");
    const user = userEvent.setup();
    mockApi({
      ...session(ada, []),
      [`GET /api/v1/workspaces/${personal.id}/integrations/providers`]: json({
        providers: [google, microsoft],
        webhooks: false,
      }),
      [`GET /api/v1/workspaces/${personal.id}/integrations/connections`]: json({
        connections: [connection()],
      }),
    });
    await renderSignedIn(<SetupGuide />);

    expect(await screen.findByText("ada@gmail.example")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Continue to Google" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Connect another" }));
    expect(screen.getByRole("button", { name: "Continue to Google" })).toBeVisible();
  });

  it("says when AI is off on the server", async () => {
    search.params = new URLSearchParams("step=ai");
    mockApi({
      ...session(ada, []),
      "GET /api/v1/me/ai/settings": json({ server_enabled: false, enabled: false }),
      "GET /api/v1/me/ai/providers": json({ providers: [] }),
    });
    await renderSignedIn(<SetupGuide />);

    expect(await screen.findByText(/AI is turned off on this Orbit server/)).toBeVisible();
  });
});

describe("Setup card", () => {
  it("shows while setup is left for later, and can be dismissed", async () => {
    const patches: MockRequest[] = [];
    mockApi(session({ ...ada, setup_status: "deferred" }, patches));
    await renderSignedIn(<SetupCard />);

    expect(screen.getByRole("link", { name: "Continue setup" })).toHaveAttribute(
      "href",
      "/welcome",
    );
    await userEvent.click(screen.getByRole("button", { name: "Dismiss setup reminder" }));

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Finish setting up Orbit" })).toBeNull(),
    );
    expect(patches[0]?.body).toEqual({ setup_status: "done" });
  });

  it("is hidden once setup is done", async () => {
    mockApi(session(ada, []));
    await renderSignedIn(<SetupCard />);

    expect(screen.queryByRole("heading", { name: "Finish setting up Orbit" })).toBeNull();
  });
});

describe("Setup redirect", () => {
  it("sends a new user to the guide", async () => {
    mockApi(session({ ...ada, setup_status: "pending" }, []));
    await renderSignedIn(
      <SetupRedirect>
        <p>App</p>
      </SetupRedirect>,
    );

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/welcome"));
    expect(screen.queryByText("App")).toBeNull();
  });

  it("opens the app for everyone else", async () => {
    mockApi(session({ ...ada, setup_status: "deferred" }, []));
    await renderSignedIn(
      <SetupRedirect>
        <p>App</p>
      </SetupRedirect>,
    );

    expect(screen.getByText("App")).toBeVisible();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
