import { afterEach, describe, expect, it } from "vitest";

import {
  NAV_STORAGE_KEY,
  navPreferenceScript,
  navPreferenceStyles,
  readNavPreference,
  writeNavPreference,
} from "./nav-preference";

afterEach(() => {
  const { dataset } = document.documentElement;
  delete dataset.navHidden;
  delete dataset.navFolded;
  localStorage.clear();
});

describe("nav preference", () => {
  it("round-trips through <html> and localStorage", () => {
    writeNavPreference({ hidden: ["finance", "places"], folded: ["library"] });
    expect(document.documentElement.dataset.navHidden).toBe("finance places");
    expect(document.documentElement.dataset.navFolded).toBe("library");
    expect(JSON.parse(localStorage.getItem(NAV_STORAGE_KEY) ?? "")).toEqual({
      hidden: ["finance", "places"],
      folded: ["library"],
    });
    expect(readNavPreference()).toEqual({ hidden: ["finance", "places"], folded: ["library"] });
  });

  it("returns the same object until the preference changes", () => {
    const first = readNavPreference();
    expect(readNavPreference()).toBe(first);
    writeNavPreference({ hidden: ["tasks"], folded: [] });
    expect(readNavPreference()).not.toBe(first);
  });

  it("ignores unknown section ids", () => {
    document.documentElement.dataset.navFolded = "plan bogus";
    expect(readNavPreference().folded).toEqual(["plan"]);
  });

  it("applies the saved preference from the head script", () => {
    localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({ hidden: ["notes"], folded: ["ai"] }));
    new Function(navPreferenceScript)();
    expect(document.documentElement.dataset.navHidden).toBe("notes");
    expect(document.documentElement.dataset.navFolded).toBe("ai");
  });

  it("survives a corrupt saved value", () => {
    localStorage.setItem(NAV_STORAGE_KEY, "{not json");
    expect(() => new Function(navPreferenceScript)()).not.toThrow();
    expect(document.documentElement.dataset.navHidden).toBeUndefined();
  });

  it("has first-paint rules for links, empty sections, and folded sections", () => {
    expect(navPreferenceStyles).toContain('[data-nav-hidden~="finance"] [data-nav-item="finance"]');
    expect(navPreferenceStyles).toContain('[data-nav-group="ai"]');
    expect(navPreferenceStyles).toContain('html[data-nav-folded~="plan"]');
    expect(navPreferenceStyles).not.toContain('[data-nav-item="dashboard"]');
    expect(navPreferenceStyles.endsWith("{display:none}")).toBe(true);
  });
});
