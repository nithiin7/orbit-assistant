import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal } from "@/test/api-mock";
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

  it("marks the fallback panel as current on the settings index", async () => {
    mockApi(signedIn);
    await renderSignedIn(<SettingsMenu activeFallback="account" />);

    expect(screen.getByRole("link", { name: /^Account/ })).toHaveAttribute("aria-current", "page");
  });
});
