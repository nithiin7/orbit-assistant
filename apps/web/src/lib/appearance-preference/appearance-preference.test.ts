import { afterEach, describe, expect, it } from "vitest";

import {
  appearancePreferenceScript,
  DENSITY_STORAGE_KEY,
  FONT_STORAGE_KEY,
  PALETTE_STORAGE_KEY,
  readDensity,
  readFont,
  readPalette,
  writeDensity,
  writeFont,
  writePalette,
} from "./appearance-preference";

const root = document.documentElement;

afterEach(() => {
  delete root.dataset.palette;
  delete root.dataset.font;
  delete root.dataset.density;
  localStorage.clear();
});

function runScript() {
  // The script is a static string built from constants; running it is how the layout applies it.
  new Function(appearancePreferenceScript)();
}

describe("appearance preference", () => {
  it("defaults to Studio and Inter Tight", () => {
    expect(readPalette()).toBe("studio");
    expect(readFont()).toBe("inter-tight");
  });

  it("stores a chosen palette and font on <html> and in localStorage", () => {
    writePalette("ocean");
    writeFont("serif");

    expect(root.dataset.palette).toBe("ocean");
    expect(root.dataset.font).toBe("serif");
    expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBe("ocean");
    expect(localStorage.getItem(FONT_STORAGE_KEY)).toBe("serif");
    expect(readPalette()).toBe("ocean");
    expect(readFont()).toBe("serif");
  });

  it("clears the attribute and stored value when returning to the defaults", () => {
    writePalette("sage");
    writeFont("inter");
    writePalette("studio");
    writeFont("inter-tight");

    expect(root.dataset.palette).toBeUndefined();
    expect(root.dataset.font).toBeUndefined();
    expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(FONT_STORAGE_KEY)).toBeNull();
  });

  it("treats unknown attribute values as the defaults", () => {
    root.dataset.palette = "neon";
    root.dataset.font = "comic";
    expect(readPalette()).toBe("studio");
    expect(readFont()).toBe("inter-tight");
  });

  it("restores saved choices before paint and ignores unknown values", () => {
    localStorage.setItem(PALETTE_STORAGE_KEY, "plum");
    localStorage.setItem(FONT_STORAGE_KEY, "legible");
    runScript();
    expect(root.dataset.palette).toBe("plum");
    expect(root.dataset.font).toBe("legible");

    delete root.dataset.palette;
    delete root.dataset.font;
    localStorage.setItem(PALETTE_STORAGE_KEY, '"><script>');
    localStorage.setItem(FONT_STORAGE_KEY, "comic");
    runScript();
    expect(root.dataset.palette).toBeUndefined();
    expect(root.dataset.font).toBeUndefined();
  });

  it("stores compact density and clears it when returning to comfortable", () => {
    expect(readDensity()).toBe("comfortable");

    writeDensity("compact");
    expect(root.dataset.density).toBe("compact");
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe("compact");
    expect(readDensity()).toBe("compact");

    writeDensity("comfortable");
    expect(root.dataset.density).toBeUndefined();
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBeNull();
  });

  it("restores a saved density before paint and ignores unknown values", () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, "compact");
    runScript();
    expect(root.dataset.density).toBe("compact");

    delete root.dataset.density;
    localStorage.setItem(DENSITY_STORAGE_KEY, "tiny");
    runScript();
    expect(root.dataset.density).toBeUndefined();
    root.dataset.density = "tiny";
    expect(readDensity()).toBe("comfortable");
  });
});
