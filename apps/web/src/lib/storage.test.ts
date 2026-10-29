import { describe, expect, it } from "vitest";

import { revealLabel } from "./storage";

describe("revealLabel", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15", "Show in Finder"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Show in File Explorer"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", "Open folder"],
  ])("names the file manager for %s", (userAgent, expected) => {
    expect(revealLabel(userAgent)).toBe(expected);
  });
});
