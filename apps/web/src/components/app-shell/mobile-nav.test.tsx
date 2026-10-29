import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { MobileNav } from "./mobile-nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

beforeAll(() => {
  // jsdom does not implement modal dialogs; emulate the open state they toggle.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe("MobileNav", () => {
  it("opens and closes the navigation drawer", async () => {
    const user = userEvent.setup();
    render(<MobileNav />);
    const drawer = screen.getByRole("dialog", { hidden: true });
    expect(drawer).not.toHaveAttribute("open");

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(drawer).toHaveAttribute("open");

    await user.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(drawer).not.toHaveAttribute("open");
  });

  it("closes the drawer after choosing a destination", async () => {
    const user = userEvent.setup();
    render(<MobileNav />);
    const drawer = screen.getByRole("dialog", { hidden: true });

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    await user.click(screen.getByRole("link", { name: "Tasks" }));
    expect(drawer).not.toHaveAttribute("open");
  });
});
