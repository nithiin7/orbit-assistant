import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navItems } from "@/lib/navigation";

import { NavLinks } from "./nav-links";

const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

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
});
