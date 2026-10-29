import { describe, expect, it } from "vitest";

import { findSettingsPanel, settingsHref, settingsPanels } from "./settings";

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
});
