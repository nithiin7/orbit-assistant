import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { navItems } from "@/lib/navigation";

import { NavLinks } from "./nav-links";

const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

afterEach(() => {
  delete document.documentElement.dataset.sidebar;
});

describe("NavLinks", () => {
  it("renders a link for every navigation item", () => {
    render(<NavLinks />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toBeInTheDocument();
    for (const item of navItems) {
      expect(screen.getByRole("link", { name: item.title })).toHaveAttribute("href", item.href);
    }
  });

  it("marks only the current page as active", () => {
    pathname.current = "/calendar";
    render(<NavLinks />);
    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("shows tooltips for icon-only links only in the collapsed sidebar", async () => {
    const user = userEvent.setup();
    document.documentElement.dataset.sidebar = "collapsed";
    const { unmount } = render(<NavLinks collapsible />);

    await user.hover(screen.getByRole("link", { name: "Dashboard" }));
    await waitFor(() => expect(screen.getAllByText("Dashboard")).toHaveLength(2));
    unmount();

    // The mobile drawer always shows labels, so it never needs tooltips.
    render(<NavLinks />);
    await user.hover(screen.getByRole("link", { name: "Dashboard" }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.getAllByText("Dashboard")).toHaveLength(1);
  });
});
