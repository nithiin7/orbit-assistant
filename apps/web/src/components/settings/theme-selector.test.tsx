import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeSelector } from "./theme-selector";

const themeState = vi.hoisted(() => ({ theme: "system" as string | undefined }));
const setTheme = vi.hoisted(() => vi.fn());

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: themeState.theme, setTheme }),
}));

beforeEach(() => {
  themeState.theme = "system";
  setTheme.mockClear();
});

describe("ThemeSelector", () => {
  it("offers light, dark, and system themes with the current one selected", () => {
    render(<ThemeSelector />);
    const group = screen.getByRole("group", { name: "Theme" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /System/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Light/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Dark/ })).not.toBeChecked();
  });

  it("sets the theme when an option is chosen", async () => {
    const user = userEvent.setup();
    render(<ThemeSelector />);

    await user.click(screen.getByRole("radio", { name: /Dark/ }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("supports arrow-key selection", async () => {
    const user = userEvent.setup();
    themeState.theme = "light";
    render(<ThemeSelector />);

    await user.tab();
    expect(screen.getByRole("radio", { name: /Light/ })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("shows a loading placeholder until the theme is known", () => {
    themeState.theme = undefined;
    render(<ThemeSelector />);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("Loading theme options…")).toBeInTheDocument();
  });
});
