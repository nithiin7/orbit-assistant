import { describe, expect, it } from "vitest";

import { formatShare, scoreBand } from "./portfolio-review";

describe("scoreBand", () => {
  it("reads 75 and up as strong, 50 and up as fair, and the rest as weak", () => {
    expect(scoreBand(100)).toBe("strong");
    expect(scoreBand(75)).toBe("strong");
    expect(scoreBand(74)).toBe("fair");
    expect(scoreBand(50)).toBe("fair");
    expect(scoreBand(49)).toBe("weak");
    expect(scoreBand(0)).toBe("weak");
  });
});

describe("formatShare", () => {
  it("shows a measured share to one decimal", () => {
    expect(formatShare("64.29")).toBe("64.3%");
    expect(formatShare("100")).toBe("100.0%");
  });

  it("shows a dash for a missing or unreadable share", () => {
    expect(formatShare(null)).toBe("—");
    expect(formatShare("n/a")).toBe("—");
  });
});
