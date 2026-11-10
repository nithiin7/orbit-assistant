import { describe, expect, it } from "vitest";

import { ALL_AREAS, parseSetupStep, setupSteps } from "./setup";

describe("setupSteps", () => {
  it("shows every step when every area is chosen", () => {
    expect(setupSteps(ALL_AREAS)).toEqual([
      "profile",
      "appearance",
      "areas",
      "finance",
      "health",
      "connect",
      "ai",
      "done",
    ]);
  });

  it("leaves out areas that weren't chosen", () => {
    expect(setupSteps(["health"])).toEqual(["profile", "appearance", "areas", "health", "done"]);
  });
});

describe("parseSetupStep", () => {
  it("accepts known steps and falls back to the first", () => {
    expect(parseSetupStep("connect")).toBe("connect");
    expect(parseSetupStep("nope")).toBe("profile");
    expect(parseSetupStep(null)).toBe("profile");
  });
});
