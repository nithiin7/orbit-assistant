import type { AppLockStatus } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { AppLockSettings } from "./app-lock-settings";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/app-lock",
  useSearchParams: () => new URLSearchParams(),
}));

const LOCK = "/api/v1/me/app-lock";

const off: AppLockStatus = {
  enabled: false,
  locked: false,
  pin_length: null,
  lock_after_minutes: 5,
  sign_out_after_minutes: null,
  attempts_left: 5,
  recently_signed_in: false,
  devices: [],
};
const on: AppLockStatus = { ...off, enabled: true, pin_length: 4 };

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

describe("AppLockSettings", () => {
  it("turns the lock on with a PIN entered twice", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    let current = off;
    mockApi({
      ...session,
      [`GET ${LOCK}`]: () => Response.json(current),
      [`PUT ${LOCK}/pin`]: (request: MockRequest) => {
        sent.push(request.body);
        current = on;
        return Response.json(on);
      },
    });
    await renderSignedIn(<AppLockSettings />);

    await user.click(await screen.findByRole("button", { name: "Turn on app lock" }));
    const dialog = await screen.findByRole("dialog", { name: "Turn on app lock" });
    expect(within(dialog).getByRole("group", { name: "Choose a PIN" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "4 digits" })).toBeChecked();

    await user.keyboard("1357");
    expect(
      await within(dialog).findByRole("group", { name: "Enter it once more" }),
    ).toBeInTheDocument();
    await user.keyboard("1358");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("didn’t match");

    await user.keyboard("1357");
    await user.keyboard("1357");

    await waitFor(() => expect(sent).toEqual([{ pin: "1357", current_pin: null }]));
    expect(await screen.findByText("App lock is on.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Lock now" })).toBeInTheDocument();
  });

  it("chooses a 6-digit PIN", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    mockApi({
      ...session,
      [`GET ${LOCK}`]: json(off),
      [`PUT ${LOCK}/pin`]: (request: MockRequest) => {
        sent.push(request.body);
        return Response.json({ ...on, pin_length: 6 });
      },
    });
    await renderSignedIn(<AppLockSettings />);

    await user.click(await screen.findByRole("button", { name: "Turn on app lock" }));
    await user.click(screen.getByRole("radio", { name: "6 digits" }));
    await user.keyboard("246802");
    await user.keyboard("246802");

    await waitFor(() => expect(sent).toEqual([{ pin: "246802", current_pin: null }]));
  });

  it("asks for the current PIN before changing it", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    mockApi({
      ...session,
      [`GET ${LOCK}`]: json(on),
      [`PUT ${LOCK}/pin`]: (request: MockRequest) => {
        sent.push(request.body);
        if ((request.body as { current_pin: string }).current_pin !== "2468") {
          return Response.json({ detail: "Incorrect PIN. 4 tries left." }, { status: 422 });
        }
        return Response.json(on);
      },
    });
    await renderSignedIn(<AppLockSettings />);

    await user.click(await screen.findByRole("button", { name: "Change PIN" }));
    const dialog = await screen.findByRole("dialog", { name: "Change your PIN" });
    expect(
      within(dialog).getByRole("group", { name: "Enter your current PIN" }),
    ).toBeInTheDocument();
    await user.keyboard("1111");
    await user.keyboard("9753");
    await user.keyboard("9753");

    // A wrong current PIN goes back to that step, with the tries left.
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("4 tries left");
    expect(
      within(dialog).getByRole("group", { name: "Enter your current PIN" }),
    ).toBeInTheDocument();
    await user.keyboard("2468");
    await user.keyboard("9753");
    await user.keyboard("9753");

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({ pin: "9753", current_pin: "2468" });
    expect(await screen.findByText("Your PIN was changed.")).toBeInTheDocument();
  });

  it("saves how soon Orbit locks and signs out", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    mockApi({
      ...session,
      [`GET ${LOCK}`]: json({ ...on, sign_out_after_minutes: 60 }),
      [`PUT ${LOCK}/timing`]: (request: MockRequest) => {
        sent.push(request.body);
        return Response.json({ ...on, lock_after_minutes: 60, sign_out_after_minutes: 240 });
      },
    });
    await renderSignedIn(<AppLockSettings />);

    await user.click(await screen.findByRole("combobox", { name: "Ask for the PIN" }));
    await user.click(screen.getByRole("option", { name: "After 1 hour" }));

    // Sign-out must stay later than the lock, so it moves along.
    await waitFor(() =>
      expect(sent).toEqual([{ lock_after_minutes: 60, sign_out_after_minutes: 240 }]),
    );
  });

  it("explains when this browser can't use a fingerprint", async () => {
    mockApi({ ...session, [`GET ${LOCK}`]: json(on) });

    await renderSignedIn(<AppLockSettings />);

    expect(await screen.findByText(/can’t use a fingerprint or face here/)).toBeInTheDocument();
    expect(screen.getByText(/The PIN always works/)).toBeInTheDocument();
  });

  it("shows an error when the lock state can't load", async () => {
    mockApi({ ...session, [`GET ${LOCK}`]: status(500) });

    await renderSignedIn(<AppLockSettings />);

    expect(await screen.findByText("Couldn’t load app lock.")).toBeInTheDocument();
  });
});
