import { describe, expect, it } from "vitest";

import { brandLogo, readableOn } from "./brand-logos";

describe("brandLogo", () => {
  it("matches a brand anywhere in the name, ignoring case and punctuation", () => {
    expect(brandLogo("Netflix Premium")?.title).toBe("Netflix");
    expect(brandLogo("my spotify family plan")?.title).toBe("Spotify");
    expect(brandLogo("iCloud+ 200GB")?.title).toBe("iCloud");
  });

  it("prefers the most specific brand", () => {
    expect(brandLogo("YouTube Music")?.title).toBe("YouTube Music");
    expect(brandLogo("YouTube Premium")?.title).toBe("YouTube");
    expect(brandLogo("Apple Music")?.title).toBe("Apple Music");
    expect(brandLogo("Apple One")?.title).toBe("Apple");
  });

  it("matches whole words only", () => {
    expect(brandLogo("Steamboat tickets")).toBeNull();
    expect(brandLogo("Box subscription")).toBeNull();
  });

  it("falls back to the provider when the name doesn't match", () => {
    expect(brandLogo("Pro plan", "Anthropic")?.title).toBe("Anthropic");
    expect(brandLogo("Claude Pro", "Anthropic")?.title).toBe("Claude");
    expect(brandLogo("Gym", null)).toBeNull();
    expect(brandLogo("", undefined)).toBeNull();
  });

  it("returns the brand color and a readable glyph color", () => {
    expect(brandLogo("Netflix")).toMatchObject({ background: "#E50914", foreground: "#FFFFFF" });
    expect(brandLogo("Notion")).toMatchObject({ background: "#000000", foreground: "#FFFFFF" });
  });
});

describe("readableOn", () => {
  it("picks black on light colors and white on dark ones", () => {
    expect(readableOn("FFFFFF")).toBe("#000000");
    expect(readableOn("FFE01B")).toBe("#000000");
    expect(readableOn("000000")).toBe("#FFFFFF");
    expect(readableOn("0061FF")).toBe("#FFFFFF");
  });
});
