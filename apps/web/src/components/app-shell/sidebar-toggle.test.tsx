import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SIDEBAR_STORAGE_KEY } from "@/lib/sidebar-preference";

import { SidebarToggle } from "./sidebar-toggle";

const viewport = vi.hoisted(() => ({ desktop: true }));

beforeEach(() => {
  // jsdom has no matchMedia; report whether the desktop sidebar breakpoint matches.
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: viewport.desktop, media }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  viewport.desktop = true;
  delete document.documentElement.dataset.sidebar;
  localStorage.clear();
});

describe("SidebarToggle", () => {
  it("collapses and expands the sidebar and remembers the choice", async () => {
    const user = userEvent.setup();
    render(<SidebarToggle />);

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(document.documentElement).toHaveAttribute("data-sidebar", "collapsed");
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("collapsed");

    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(document.documentElement).toHaveAttribute("data-sidebar", "expanded");
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("expanded");
  });

  it("reflects a preference applied before hydration", () => {
    document.documentElement.dataset.sidebar = "collapsed";
    render(<SidebarToggle />);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("toggles with Ctrl+B outside text fields", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SidebarToggle />
        <input aria-label="Notes" />
      </>,
    );

    await user.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();

    await user.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();

    await user.click(screen.getByRole("textbox", { name: "Notes" }));
    await user.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
  });

  it("ignores the shortcut when the desktop sidebar is hidden", async () => {
    const user = userEvent.setup();
    viewport.desktop = false;
    render(<SidebarToggle />);

    await user.keyboard("{Control>}b{/Control}");
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    expect(document.documentElement).not.toHaveAttribute("data-sidebar");
  });

  it("advertises the shortcut", () => {
    render(<SidebarToggle />);
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+B",
    );
  });
});
