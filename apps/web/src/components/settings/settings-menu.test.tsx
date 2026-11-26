import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { SettingsMenu } from "./settings-menu";

const pathname = vi.hoisted(() => ({ current: "/settings" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => pathname.current,
}));

const signedIn = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  pathname.current = "/settings";
});

describe("SettingsMenu", () => {
  it("links the profile row and each settings group to its own page", async () => {
    mockApi(signedIn);
    await renderSignedIn(<SettingsMenu />);

    const menu = screen.getByRole("navigation", { name: "Settings" });
    const profile = within(menu).getByRole("link", { name: /^Account: Ada/ });
    expect(profile).toHaveAttribute("href", "/settings/account");
    expect(profile).toHaveTextContent("ada@example.com");

    for (const [name, href] of [
      ["Workspaces", "/settings/workspaces"],
      ["Appearance", "/settings/appearance"],
      ["Storage", "/settings/storage"],
    ]) {
      expect(within(menu).getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute(
        "href",
        href,
      );
    }
  });

  it("marks the open panel as current", async () => {
    pathname.current = "/settings/storage";
    mockApi(signedIn);
    await renderSignedIn(<SettingsMenu />);

    expect(screen.getByRole("link", { name: /^Storage/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /^Account/ })).not.toHaveAttribute("aria-current");
  });

  it("filters the panels by title or keyword and says when nothing matches", async () => {
    mockApi(signedIn);
    const user = userEvent.setup();
    await renderSignedIn(<SettingsMenu variant="rail" />);

    const search = screen.getByRole("searchbox", { name: "Search settings" });
    await user.type(search, "dark");
    expect(screen.getByRole("link", { name: /^Appearance/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Storage/ })).not.toBeInTheDocument();
    // The profile row stays, so account settings are always one click away.
    expect(screen.getByRole("link", { name: /^Account: Ada/ })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.getByText(/No settings match/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Appearance/ })).not.toBeInTheDocument();
  });

  it("groups the panels under labelled lists", async () => {
    mockApi(signedIn);
    await renderSignedIn(<SettingsMenu />);

    const data = screen.getByRole("list", { name: "Your data" });
    expect(within(data).getByRole("link", { name: /^Backup & restore/ })).toBeInTheDocument();
    expect(within(data).getByRole("link", { name: /^Storage/ })).toBeInTheDocument();
  });

  it("marks the fallback panel as current on the settings index", async () => {
    mockApi(signedIn);
    await renderSignedIn(<SettingsMenu activeFallback="account" />);

    expect(screen.getByRole("link", { name: /^Account/ })).toHaveAttribute("aria-current", "page");
  });
});
