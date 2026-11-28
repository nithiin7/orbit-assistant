import type { AppLockStatus } from "@orbit/contracts";
import { useQuery } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { request } from "@/api/client";
import { EVENT_KEY } from "@/lib/app-lock";
import { useAuth } from "@/providers/auth";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { AppLockGate } from "./app-lock-gate";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams(),
}));

const LOCK = "/api/v1/me/app-lock";

const lockStatus = (overrides: Partial<AppLockStatus> = {}): AppLockStatus => ({
  enabled: true,
  locked: false,
  pin_length: 4,
  lock_after_minutes: 5,
  sign_out_after_minutes: null,
  attempts_left: 5,
  recently_signed_in: false,
  devices: [],
  ...overrides,
});

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

/** Stands in for any page: it loads private data, which a locked session can't. */
function PrivatePage() {
  const { withToken } = useAuth();
  const notes = useQuery({
    queryKey: ["workspaces", personal.id, "notes"],
    queryFn: () => withToken((token) => request<{ title: string }>("/api/v1/private", { token })),
  });
  return <p>{notes.data?.title ?? "Loading private page"}</p>;
}

function renderGate() {
  return renderSignedIn(
    <AppLockGate>
      <PrivatePage />
    </AppLockGate>,
  );
}

describe("AppLockGate", () => {
  it("shows the app when the lock is off", async () => {
    mockApi({
      ...session,
      [`GET ${LOCK}`]: json(lockStatus({ enabled: false, pin_length: null })),
      "GET /api/v1/private": json({ title: "Diary" }),
    });

    await renderGate();

    expect(await screen.findByText("Diary")).toBeInTheDocument();
  });

  it("shows the lock screen instead of the app, and unlocks with the PIN", async () => {
    const user = userEvent.setup();
    const pins: unknown[] = [];
    let locked = true;
    mockApi({
      ...session,
      [`GET ${LOCK}`]: () => Response.json(lockStatus({ locked })),
      [`POST ${LOCK}/unlock`]: (request: MockRequest) => {
        pins.push(request.body);
        if ((request.body as { pin: string }).pin !== "2468") {
          return Response.json({ detail: "Incorrect PIN. 4 tries left." }, { status: 422 });
        }
        locked = false;
        return Response.json(lockStatus());
      },
      "GET /api/v1/private": () =>
        locked
          ? Response.json({ detail: "Orbit is locked." }, { status: 423 })
          : Response.json({ title: "Diary" }),
    });

    await renderGate();

    expect(await screen.findByRole("heading", { name: "Welcome back, Ada" })).toBeInTheDocument();
    expect(screen.queryByText("Diary")).not.toBeInTheDocument();
    expect(screen.getByText("Enter your 4-digit PIN")).toBeInTheDocument();

    await user.keyboard("1111");
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect PIN. 4 tries left.");

    await user.keyboard("2468");

    expect(await screen.findByText("Diary")).toBeInTheDocument();
    expect(pins).toEqual([{ pin: "1111" }, { pin: "2468" }]);
  });

  it("locks when any request finds the session locked", async () => {
    mockApi({
      ...session,
      [`GET ${LOCK}`]: json(lockStatus()),
      "GET /api/v1/private": status(423, "Orbit is locked. Unlock it to continue."),
    });

    await renderGate();

    expect(await screen.findByRole("heading", { name: "Welcome back, Ada" })).toBeInTheDocument();
  });

  it("follows another tab that locked", async () => {
    mockApi({
      ...session,
      [`GET ${LOCK}`]: json(lockStatus()),
      "GET /api/v1/private": json({ title: "Diary" }),
    });
    await renderGate();
    expect(await screen.findByText("Diary")).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: EVENT_KEY, newValue: "locked:1" }));
    });

    expect(await screen.findByRole("heading", { name: "Welcome back, Ada" })).toBeInTheDocument();
    expect(screen.queryByText("Diary")).not.toBeInTheDocument();
  });

  it("locks at once with Ctrl+Shift+L", async () => {
    const user = userEvent.setup();
    const lock = vi.fn(() => Response.json(lockStatus({ locked: true })));
    mockApi({
      ...session,
      [`GET ${LOCK}`]: json(lockStatus()),
      [`POST ${LOCK}/lock`]: lock,
      "GET /api/v1/private": json({ title: "Diary" }),
    });
    await renderGate();
    expect(await screen.findByText("Diary")).toBeInTheDocument();

    await user.keyboard("{Control>}{Shift>}L{/Shift}{/Control}");

    expect(await screen.findByRole("heading", { name: "Welcome back, Ada" })).toBeInTheDocument();
    expect(screen.queryByText("Diary")).not.toBeInTheDocument();
    await waitFor(() => expect(lock).toHaveBeenCalled());
  });

  it("ignores the shortcut when app lock is off", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      [`GET ${LOCK}`]: json(lockStatus({ enabled: false, pin_length: null })),
      "GET /api/v1/private": json({ title: "Diary" }),
    });
    await renderGate();
    expect(await screen.findByText("Diary")).toBeInTheDocument();

    await user.keyboard("{Control>}{Shift>}L{/Shift}{/Control}");

    expect(screen.getByText("Diary")).toBeInTheDocument();
  });

  it("signs out from the lock screen", async () => {
    const user = userEvent.setup();
    const signedOut = vi.fn(() => new Response(null, { status: 204 }));
    mockApi({
      ...session,
      [`GET ${LOCK}`]: json(lockStatus({ locked: true })),
      "POST /api/v1/auth/local/sign-out": signedOut,
    });
    await renderGate();

    await user.click(await screen.findByRole("button", { name: "Forgot PIN?" }));
    expect(screen.getByText(/sign back in with your password/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signedOut).toHaveBeenCalled());
  });
});
