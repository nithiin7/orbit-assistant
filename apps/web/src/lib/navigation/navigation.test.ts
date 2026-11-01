import { describe, expect, it } from "vitest";

import { findSection, isActivePath, navItems, sectionItems } from "./navigation";

describe("navigation", () => {
  it("defines unique routes for every item", () => {
    const hrefs = navItems.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("excludes routes with dedicated pages from placeholder sections", () => {
    const hrefs = sectionItems.map((item) => item.href);
    expect(hrefs).not.toContain("/");
    expect(hrefs).not.toContain("/tasks");
    expect(hrefs).not.toContain("/shopping");
    expect(hrefs).not.toContain("/calendar");
    expect(hrefs).not.toContain("/settings");
  });

  it("finds sections by slug", () => {
    expect(findSection("assistant")?.title).toBe("Assistant");
    expect(findSection("calendar")).toBeUndefined();
    expect(findSection("notes")).toBeUndefined();
    expect(findSection("unknown")).toBeUndefined();
    expect(findSection("tasks")).toBeUndefined();
    expect(findSection("shopping")).toBeUndefined();
    expect(findSection("settings")).toBeUndefined();
  });

  it.each([
    ["/", "/", true],
    ["/tasks", "/", false],
    ["/tasks", "/tasks", true],
    ["/tasks/today", "/tasks", true],
    ["/tasks-archive", "/tasks", false],
  ])("isActivePath(%s, %s) is %s", (pathname, href, expected) => {
    expect(isActivePath(pathname, href)).toBe(expected);
  });
});
