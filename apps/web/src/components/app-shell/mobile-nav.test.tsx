import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CommandPaletteProvider } from "@/components/command-palette/command-palette";

import { MobileNav } from "./mobile-nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

function renderMobileNav() {
  render(
    <CommandPaletteProvider>
      <MobileNav />
    </CommandPaletteProvider>,
  );
  return screen.getByLabelText("Navigation", { selector: "dialog" });
}

describe("MobileNav", () => {
  it("opens and closes the navigation drawer", async () => {
    const user = userEvent.setup();
    const drawer = renderMobileNav();
    expect(drawer).not.toHaveAttribute("open");

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(drawer).toHaveAttribute("open");

    await user.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(drawer).not.toHaveAttribute("open");
  });

  it("closes the drawer after choosing a destination", async () => {
    const user = userEvent.setup();
    const drawer = renderMobileNav();

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    await user.click(screen.getByRole("link", { name: "Tasks" }));
    expect(drawer).not.toHaveAttribute("open");
  });
});
