import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FONT_STORAGE_KEY, PALETTE_STORAGE_KEY } from "@/lib/appearance-preference";

import { AppearanceSettings } from "./appearance-settings";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

const root = document.documentElement;

afterEach(() => {
  delete root.dataset.palette;
  delete root.dataset.font;
  localStorage.clear();
});

describe("AppearanceSettings", () => {
  it("shows mode, color theme, and font, with the defaults selected", () => {
    render(<AppearanceSettings />);

    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Color theme" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Font" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Clay/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Geist/ })).toBeChecked();
  });

  it("reflects a saved choice", () => {
    root.dataset.palette = "slate";
    root.dataset.font = "inter";
    render(<AppearanceSettings />);

    expect(screen.getByRole("radio", { name: /Slate/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Inter/ })).toBeChecked();
  });

  it("applies and saves a new color theme and font", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    await user.click(screen.getByRole("radio", { name: /Sage/ }));
    expect(screen.getByRole("radio", { name: /Sage/ })).toBeChecked();
    expect(root.dataset.palette).toBe("sage");
    expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBe("sage");

    await user.click(screen.getByRole("radio", { name: /Source Serif/ }));
    expect(screen.getByRole("radio", { name: /Source Serif/ })).toBeChecked();
    expect(root.dataset.font).toBe("serif");
    expect(localStorage.getItem(FONT_STORAGE_KEY)).toBe("serif");
  });

  it("returns to the default by clearing the saved choice", async () => {
    root.dataset.palette = "plum";
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    await user.click(screen.getByRole("radio", { name: /Clay/ }));
    expect(root.dataset.palette).toBeUndefined();
    expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBeNull();
  });
});
