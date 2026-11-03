import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { ChangePassword } from "./change-password";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/account",
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: true }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function fill(current: string, next: string, confirm = next) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Confirm new password"), confirm);
  await user.click(screen.getByRole("button", { name: "Change password" }));
}

describe("ChangePassword", () => {
  it("sends the current and new password and confirms the change", async () => {
    const api = mockApi({ ...session, "POST /api/v1/auth/local/password": status(204) });
    await renderSignedIn(<ChangePassword />);

    await fill("old secret", "a brand new secret");

    expect(
      await screen.findByText("Password changed. Other sessions were signed out."),
    ).toBeInTheDocument();
    const call = api.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      current_password: "old secret",
      new_password: "a brand new secret",
    });
    expect(screen.getByLabelText("Current password")).toHaveValue("");
  });

  it("checks the new password before sending anything", async () => {
    const api = mockApi(session);
    await renderSignedIn(<ChangePassword />);

    await fill("old secret", "short", "different");

    expect(await screen.findByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(screen.getByText("The passwords don’t match.")).toBeInTheDocument();
    expect(api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("shows the server's reason when the current password is wrong", async () => {
    mockApi({
      ...session,
      "POST /api/v1/auth/local/password": status(403, "The current password is incorrect."),
    });
    await renderSignedIn(<ChangePassword />);

    await fill("wrong", "a brand new secret");

    expect(await screen.findByText("The current password is incorrect.")).toBeInTheDocument();
  });
});
