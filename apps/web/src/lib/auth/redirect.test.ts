import { describe, expect, it } from "vitest";

import { safeNextPath, signInPath } from "./redirect";

describe("safeNextPath", () => {
  it.each([
    ["/tasks", "/tasks"],
    ["/settings?tab=account#workspace", "/settings?tab=account#workspace"],
    ["/a/../settings", "/settings"],
  ])("keeps in-app path %s", (value, expected) => {
    expect(safeNextPath(value)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "tasks",
    "//evil.example",
    "/\\evil.example",
    "https://evil.example/",
    "javascript:alert(1)",
    "/sign-in",
    "/sign-up?next=/tasks",
  ])("falls back to the dashboard for %s", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });
});

describe("signInPath", () => {
  it("returns to the requested page after signing in", () => {
    expect(signInPath("/settings")).toBe("/sign-in?next=%2Fsettings");
    expect(signInPath("/")).toBe("/sign-in");
  });
});
