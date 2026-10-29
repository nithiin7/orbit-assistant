import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountSettings } from "@/components/settings/account-settings";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import { readLocalSession } from "@/lib/auth/local-session";
import { workspacePreferenceKey } from "@/lib/workspaces";
import { ada, json, lab, mockApi, personal, status, workspace } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { WorkspaceOverview } from "./workspace-overview";
import { WorkspaceSwitcher } from "./workspace-switcher";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("WorkspaceSwitcher", () => {
  it("starts in the personal workspace", async () => {
    mockApi({ ...session, "GET /api/v1/workspaces": json({ workspaces: [personal, lab] }) });

    await renderSignedIn(<WorkspaceSwitcher />);

    expect(await screen.findByRole("button", { name: /Workspace: Personal/ })).toBeInTheDocument();
  });

  it("switches workspaces from the keyboard and remembers the choice", async () => {
    const user = userEvent.setup();
    mockApi({ ...session, "GET /api/v1/workspaces": json({ workspaces: [personal, lab] }) });
    await renderSignedIn(<WorkspaceSwitcher />);

    const trigger = await screen.findByRole("button", { name: /Workspace: Personal/ });
    trigger.focus();
    await user.keyboard("{ArrowDown}");

    const menu = screen.getByRole("menu", { name: "Workspaces" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByRole("menuitemradio", { name: "Personal" })).toHaveFocus();
    expect(within(menu).getByRole("menuitemradio", { name: "Personal" })).toBeChecked();

    await user.keyboard("{ArrowDown}{Enter}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Workspace: Lab/ })).toHaveFocus();
    expect(localStorage.getItem(workspacePreferenceKey(ada.id))).toBe(lab.id);
  });

  it("closes on Escape and returns focus", async () => {
    const user = userEvent.setup();
    mockApi({ ...session, "GET /api/v1/workspaces": json({ workspaces: [personal] }) });
    await renderSignedIn(<WorkspaceSwitcher />);

    await user.click(await screen.findByRole("button", { name: /Workspace: Personal/ }));
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Workspace: Personal/ })).toHaveFocus();
  });

  it("restores the remembered workspace after a reload", async () => {
    localStorage.setItem(workspacePreferenceKey(ada.id), lab.id);
    mockApi({ ...session, "GET /api/v1/workspaces": json({ workspaces: [personal, lab] }) });

    await renderSignedIn(<WorkspaceSwitcher />);

    expect(await screen.findByRole("button", { name: /Workspace: Lab/ })).toBeInTheDocument();
  });

  it("ignores a remembered workspace the user can no longer access", async () => {
    localStorage.setItem(workspacePreferenceKey(ada.id), "someone-elses-workspace");
    mockApi({ ...session, "GET /api/v1/workspaces": json({ workspaces: [lab, personal] }) });

    await renderSignedIn(<WorkspaceSwitcher />);

    expect(await screen.findByRole("button", { name: /Workspace: Personal/ })).toBeInTheDocument();
  });

  it("signs out from the menu", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session,
      "GET /api/v1/workspaces": json({ workspaces: [personal] }),
      "POST /api/v1/auth/local/sign-out": status(204),
    });
    await renderSignedIn(<WorkspaceSwitcher />);

    await user.click(await screen.findByRole("button", { name: /Workspace: Personal/ }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/sign-in"));
    expect(readLocalSession()).toBeNull();
    expect(api).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/local/sign-out",
      expect.anything(),
    );
  });

  it("offers a retry when workspaces can't be loaded", async () => {
    const user = userEvent.setup();
    let failing = true;
    mockApi({
      ...session,
      "GET /api/v1/workspaces": () =>
        failing ? new Response(null, { status: 503 }) : Response.json({ workspaces: [personal] }),
    });
    await renderSignedIn(<WorkspaceSwitcher />);

    const retry = await screen.findByRole("button", { name: "Retry loading workspaces" });
    expect(retry).toHaveAccessibleDescription(/database is unavailable/);
    failing = false;
    await user.click(retry);

    expect(await screen.findByRole("button", { name: /Workspace: Personal/ })).toBeInTheDocument();
  });
});

describe("WorkspaceOverview", () => {
  it("shows the active workspace as confirmed by the API", async () => {
    mockApi({
      ...session,
      "GET /api/v1/workspaces": json({ workspaces: [personal] }),
      [`GET /api/v1/workspaces/${personal.id}`]: json(personal),
    });

    await renderSignedIn(<WorkspaceOverview />);

    expect(await screen.findByText("Personal", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText(/Signed in as Ada/)).toBeInTheDocument();
  });

  it("never shows the previous workspace's data after switching", async () => {
    const user = userEvent.setup();
    let releasePersonal: () => void = () => {};
    const signals: AbortSignal[] = [];
    mockApi({
      ...session,
      "GET /api/v1/workspaces": json({ workspaces: [personal, lab] }),
      // The personal workspace responds slowly, after the user has already switched away.
      [`GET /api/v1/workspaces/${personal.id}`]: ({ signal }) => {
        if (signal) signals.push(signal);
        return new Promise((resolve) => {
          releasePersonal = () => resolve(Response.json(personal));
        });
      },
      [`GET /api/v1/workspaces/${lab.id}`]: json(lab),
    });
    await renderSignedIn(
      <>
        <WorkspaceSwitcher />
        <WorkspaceOverview />
      </>,
    );

    await user.click(await screen.findByRole("button", { name: /Workspace: Personal/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "Lab" }));
    expect(await screen.findByText("Lab", { selector: "p" })).toBeInTheDocument();

    await act(async () => releasePersonal());

    expect(signals[0]?.aborted).toBe(true);
    expect(screen.getByText("Lab", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("Personal", { selector: "p" })).not.toBeInTheDocument();
  });

  it("re-validates the workspace list when the API no longer recognizes a workspace", async () => {
    let lists = 0;
    mockApi({
      ...session,
      "GET /api/v1/workspaces": () => {
        lists += 1;
        return Response.json({ workspaces: [personal] });
      },
      [`GET /api/v1/workspaces/${personal.id}`]: status(404, "Workspace not found."),
    });

    await renderSignedIn(<WorkspaceOverview />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace not found.");
    await waitFor(() => expect(lists).toBe(2));
  });
});

describe("WorkspaceSettings", () => {
  it("creates a workspace and switches to it", async () => {
    const user = userEvent.setup();
    const created = workspace({ id: "0d1c0ffe-2222-4c2b-9e57-000000000003", name: "Garden" });
    const api = mockApi({
      ...session,
      "GET /api/v1/workspaces": json({ workspaces: [personal] }),
      "POST /api/v1/workspaces": json(created, 201),
    });
    await renderSignedIn(
      <>
        <WorkspaceSwitcher />
        <WorkspaceSettings />
      </>,
    );

    await user.type(await screen.findByLabelText("New workspace"), "  Garden ");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(await screen.findByText("Created and switched to Garden.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Workspace: Garden/ })).toBeInTheDocument();
    const createCall = api.mock.calls.find(([, init]) => init?.method === "POST");
    expect(createCall?.[1]?.body).toBe(JSON.stringify({ name: "Garden" }));
  });

  it("renames the current workspace and reports API errors", async () => {
    const user = userEvent.setup();
    let fail = true;
    mockApi({
      ...session,
      "GET /api/v1/workspaces": json({ workspaces: [personal] }),
      [`PATCH /api/v1/workspaces/${personal.id}`]: ({ body }) =>
        fail
          ? Response.json({ detail: "Workspace not found." }, { status: 404 })
          : Response.json({ ...personal, ...(body as object) }),
    });
    await renderSignedIn(<WorkspaceSettings />);

    const name = await screen.findByLabelText("Current workspace name");
    await user.clear(name);
    await user.type(name, "Home");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(await screen.findByText("Workspace not found.")).toBeInTheDocument();
    expect(screen.getByText("Workspace not found.").closest("[role=alert]")).not.toBeNull();

    fail = false;
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(screen.getByText("Home", { selector: "span" })).toBeInTheDocument();
  });

  it("deletes the current workspace after typing its name, then returns to Personal", async () => {
    const user = userEvent.setup();
    // React reports problems such as duplicate sibling keys only through console.error.
    const consoleError = vi.spyOn(console, "error");
    localStorage.setItem(workspacePreferenceKey(ada.id), lab.id);
    const api = mockApi({
      ...session,
      "GET /api/v1/workspaces": json({ workspaces: [personal, lab] }),
      [`DELETE /api/v1/workspaces/${lab.id}`]: status(204),
    });
    await renderSignedIn(
      <>
        <WorkspaceSwitcher />
        <WorkspaceSettings />
      </>,
    );

    await user.click(await screen.findByRole("button", { name: "Delete workspace…" }));
    const confirm = screen.getByRole("button", { name: "Delete workspace" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Type Lab to confirm"), "Lab");
    await user.click(confirm);

    expect(await screen.findByRole("button", { name: /Workspace: Personal/ })).toBeInTheDocument();
    expect(api.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
    expect(screen.queryByRole("button", { name: "Switch to Lab" })).not.toBeInTheDocument();
    expect(localStorage.getItem(workspacePreferenceKey(ada.id))).toBe(personal.id);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("never offers to delete the personal workspace", async () => {
    mockApi({ ...session, "GET /api/v1/workspaces": json({ workspaces: [personal, lab] }) });
    await renderSignedIn(<WorkspaceSettings />);

    await screen.findByLabelText("Current workspace name");
    expect(screen.queryByRole("button", { name: /Delete workspace/ })).not.toBeInTheDocument();
  });

  it("validates names before contacting the API", async () => {
    const user = userEvent.setup();
    const api = mockApi({ ...session, "GET /api/v1/workspaces": json({ workspaces: [personal] }) });
    await renderSignedIn(<WorkspaceSettings />);

    await user.click(await screen.findByRole("button", { name: "Create workspace" }));

    expect(screen.getByLabelText("New workspace")).toHaveAccessibleDescription(
      /Enter a workspace name./,
    );
    expect(api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
});

describe("AccountSettings", () => {
  it("updates the display name", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      "GET /api/v1/workspaces": json({ workspaces: [personal] }),
      "PATCH /api/v1/me": ({ body }) => Response.json({ ...ada, ...(body as object) }),
    });
    await renderSignedIn(<AccountSettings />);

    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    const name = screen.getByLabelText("Display name");
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    await user.clear(name);
    await user.type(name, "Countess");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(name).toHaveValue("Countess");
  });

  it("signs the user out when the API rejects the session", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      "GET /api/v1/workspaces": json({ workspaces: [personal] }),
      "PATCH /api/v1/me": status(401, "Sign in to continue."),
    });
    await renderSignedIn(<AccountSettings />);

    await user.type(screen.getByLabelText("Display name"), "!");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/sign-in"));
    expect(readLocalSession()).toBeNull();
  });
});
