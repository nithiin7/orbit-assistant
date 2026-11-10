import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sidebarSections } from "@/lib/navigation";

import { NavLinks } from "./nav-links";

const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

afterEach(() => {
  pathname.current = "/";
  const { dataset } = document.documentElement;
  delete dataset.sidebar;
  delete dataset.navHidden;
  delete dataset.navFolded;
  localStorage.clear();
});

describe("NavLinks", () => {
  it("renders a link for every sidebar item, leaving settings to the profile menu", () => {
    render(<NavLinks />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toBeInTheDocument();
    for (const item of sidebarSections.flatMap((section) => section.items)) {
      expect(screen.getByRole("link", { name: item.title })).toHaveAttribute("href", item.href);
    }
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("groups links under labelled sections", () => {
    render(<NavLinks />);
    const plan = screen.getByRole("list", { name: "Plan" });
    expect(
      within(plan)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Tasks", "Calendar", "Reminders", "Shopping"]);
    expect(
      within(screen.getByRole("list", { name: "AI" })).getByRole("link", { name: "Assistant" }),
    ).toBeInTheDocument();
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

  it("leaves out hidden links and drops a section whose links are all hidden", () => {
    document.documentElement.dataset.navHidden = "finance assistant automation";
    render(<NavLinks />);
    expect(screen.queryByRole("link", { name: "Finance" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Habits" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "AI" })).not.toBeInTheDocument();
  });

  it("folds a section to its heading, keeps the current page, and remembers it", async () => {
    const user = userEvent.setup();
    pathname.current = "/notes";
    render(<NavLinks />);

    const heading = screen.getByRole("button", { name: "Library" });
    expect(heading).toHaveAttribute("aria-expanded", "true");
    await user.click(heading);

    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Notes" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Documents" })).not.toBeInTheDocument();
    expect(document.documentElement.dataset.navFolded).toBe("library");
    expect(localStorage.getItem("orbit:nav")).toBe(
      JSON.stringify({ hidden: [], folded: ["library"] }),
    );

    await user.click(heading);
    expect(screen.getByRole("link", { name: "Documents" })).toBeInTheDocument();
  });

  it("shows every link of a folded section in the collapsed sidebar", () => {
    document.documentElement.dataset.sidebar = "collapsed";
    document.documentElement.dataset.navFolded = "library";
    render(<NavLinks collapsible />);
    expect(screen.getByRole("link", { name: "Documents" })).toBeInTheDocument();
  });
});
