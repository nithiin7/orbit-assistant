import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPaletteProvider } from "@/components/command-palette/command-palette";
import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { MobileNav } from "./mobile-nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

beforeEach(() => {
  mockApi({
    "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
    "GET /api/v1/me": json(ada),
    "GET /api/v1/me/avatar": status(204),
    "GET /api/v1/workspaces": json({ workspaces: [personal] }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function renderMobileNav() {
  await renderSignedIn(
    <CommandPaletteProvider>
      <MobileNav />
    </CommandPaletteProvider>,
  );
  return screen.getByLabelText("Navigation", { selector: "dialog" });
}

describe("MobileNav", () => {
  it("opens and closes the navigation drawer", async () => {
    const user = userEvent.setup();
    const drawer = await renderMobileNav();
    expect(drawer).not.toHaveAttribute("open");

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(drawer).toHaveAttribute("open");

    await user.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(drawer).not.toHaveAttribute("open");
  });

  it("closes the drawer after choosing a destination", async () => {
    const user = userEvent.setup();
    const drawer = await renderMobileNav();

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    await user.click(screen.getByRole("link", { name: "Tasks" }));
    expect(drawer).not.toHaveAttribute("open");
  });
});
