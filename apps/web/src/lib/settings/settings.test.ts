import { describe, expect, it } from "vitest";

import {
  findSettingsPanel,
  matchesSettingsQuery,
  settingsHref,
  settingsPanels,
  settingsSectionLabel,
  settingsSections,
} from "./settings";

describe("settings panels", () => {
  it("defines unique slugs for every panel", () => {
    const slugs = settingsPanels.map((panel) => panel.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("finds panels by slug", () => {
    expect(findSettingsPanel("workspaces")?.title).toBe("Workspaces");
    expect(findSettingsPanel("unknown")).toBeUndefined();
  });

  it("builds sub-page routes under /settings", () => {
    expect(settingsHref("account")).toBe("/settings/account");
  });

  it("puts every panel but Account in a menu group", () => {
    const groups = new Set(settingsSections.map((section) => section.value));
    for (const panel of settingsPanels) {
      if (panel.slug === "account") expect(panel.section).toBe("account");
      else expect(groups.has(panel.section)).toBe(true);
    }
    expect(settingsSectionLabel("data")).toBe("Your data");
  });

  it("matches searches by title, description, or keyword, ignoring case", () => {
    const appearance = findSettingsPanel("appearance");
    if (!appearance) throw new Error("missing panel");
    expect(matchesSettingsQuery(appearance, "  ")).toBe(true);
    expect(matchesSettingsQuery(appearance, "APPEAR")).toBe(true);
    expect(matchesSettingsQuery(appearance, "font")).toBe(true);
    expect(matchesSettingsQuery(appearance, "dark")).toBe(true);
    expect(matchesSettingsQuery(appearance, "backup")).toBe(false);
  });
});
