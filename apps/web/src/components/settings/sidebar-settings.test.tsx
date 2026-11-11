import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NavLinks } from "@/components/app-shell/nav-links";

import { SidebarSettings } from "./sidebar-settings";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

afterEach(() => {
  const { dataset } = document.documentElement;
  delete dataset.navHidden;
  delete dataset.navFolded;
  localStorage.clear();
});

describe("SidebarSettings", () => {
  it("hides and shows sidebar links", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SidebarSettings />
        <NavLinks />
      </>,
    );

    const finance = screen.getByRole("switch", { name: "Finance" });
    expect(finance).toHaveAttribute("aria-checked", "true");
    await user.click(finance);

    expect(finance).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("link", { name: "Finance" })).not.toBeInTheDocument();
    expect(document.documentElement.dataset.navHidden).toBe("finance");

    await user.click(screen.getByRole("button", { name: "Show everything" }));
    expect(screen.getByRole("link", { name: "Finance" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show everything" })).not.toBeInTheDocument();
  });

  it("never offers to hide the dashboard", () => {
    render(<SidebarSettings />);
    expect(screen.queryByRole("switch", { name: "Dashboard" })).not.toBeInTheDocument();
  });
});
