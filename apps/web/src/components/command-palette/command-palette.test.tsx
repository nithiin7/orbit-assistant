import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPaletteProvider } from "./command-palette";
import { CommandPaletteTrigger } from "./command-palette-trigger";

const push = vi.hoisted(() => vi.fn());
const setTheme = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme }),
}));

beforeEach(() => {
  push.mockClear();
  setTheme.mockClear();
});

function renderPalette() {
  render(
    <CommandPaletteProvider>
      <CommandPaletteTrigger />
    </CommandPaletteProvider>,
  );
  return screen.getByLabelText("Command palette", { selector: "dialog" });
}

describe("CommandPalette", () => {
  it("opens with Ctrl+K, focuses the search field, and toggles closed", async () => {
    const user = userEvent.setup();
    const dialog = renderPalette();
    expect(dialog).not.toHaveAttribute("open");

    await user.keyboard("{Control>}k{/Control}");
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByRole("combobox", { name: "Search pages and actions" })).toHaveFocus();

    await user.keyboard("{Control>}k{/Control}");
    expect(dialog).not.toHaveAttribute("open");
  });

  it("opens from the trigger and restores focus to it on close", async () => {
    const user = userEvent.setup();
    const dialog = renderPalette();
    const trigger = screen.getByRole("button", { name: "Search" });

    await user.click(trigger);
    expect(dialog).toHaveAttribute("open");

    await user.keyboard("{Control>}k{/Control}");
    expect(trigger).toHaveFocus();
  });

  it("filters destinations and navigates to the chosen one with Enter", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.click(screen.getByRole("button", { name: "Search" }));

    await user.keyboard("calendar");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveAccessibleName(/Calendar/);

    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/calendar");
    expect(screen.getByLabelText("Command palette", { selector: "dialog" })).not.toHaveAttribute(
      "open",
    );
  });

  it("moves the active option with the arrow keys", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.click(screen.getByRole("button", { name: "Search" }));
    const input = screen.getByRole("combobox");

    const [first, second] = screen.getAllByRole("option");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", first?.id);

    await user.keyboard("{ArrowDown}");
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", second?.id);

    await user.keyboard("{ArrowUp}{ArrowUp}");
    const options = screen.getAllByRole("option");
    expect(options.at(-1)).toHaveAttribute("aria-selected", "true");
  });

  it("switches theme from a theme command", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.click(screen.getByRole("button", { name: "Search" }));

    await user.keyboard("dark");
    await user.click(screen.getByRole("option", { name: /Dark theme/ }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.click(screen.getByRole("button", { name: "Search" }));

    await user.keyboard("zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No results for “zzz”")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 results");
  });
});
