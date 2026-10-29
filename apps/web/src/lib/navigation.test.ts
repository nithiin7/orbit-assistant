import { describe, expect, it } from "vitest";

import { findSection, isActivePath, navItems, sectionItems } from "./navigation";

describe("navigation", () => {
  it("defines unique routes for every item", () => {
    const hrefs = navItems.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("excludes the dashboard from section routes", () => {
    expect(sectionItems.map((item) => item.href)).not.toContain("/");
  });

  it("finds sections by slug", () => {
    expect(findSection("tasks")?.title).toBe("Tasks");
    expect(findSection("unknown")).toBeUndefined();
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
