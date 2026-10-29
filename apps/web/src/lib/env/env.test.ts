import { describe, expect, it } from "vitest";

import { parseApiUrl } from "./env";

describe("parseApiUrl", () => {
  it("falls back to the local API when unset", () => {
    expect(parseApiUrl(undefined)).toBe("http://localhost:8000");
    expect(parseApiUrl("  ")).toBe("http://localhost:8000");
  });

  it("normalizes trailing slashes", () => {
    expect(parseApiUrl("https://api.example.com/")).toBe("https://api.example.com");
    expect(parseApiUrl("https://example.com/orbit//")).toBe("https://example.com/orbit");
  });

  it("rejects invalid URLs", () => {
    expect(() => parseApiUrl("not a url")).toThrow(/absolute URL/);
    expect(() => parseApiUrl("ftp://example.com")).toThrow(/http or https/);
  });
});
