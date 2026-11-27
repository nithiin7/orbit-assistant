/**
 * Color theme ("palette"), font, and list density preferences. Like the sidebar preference, each
 * lives on an attribute of `<html>` (`data-palette`, `data-font`, `data-density`) so CSS applies it
 * before React hydrates, and is saved per browser in localStorage. The defaults, Studio, Inter
 * Tight, and Comfortable, set no attribute, so the base styles apply unchanged.
 */

export const PALETTES = [
  {
    value: "studio",
    label: "Studio",
    description: "Cream and ink with violet and sun",
    swatch: ["oklch(0.977 0.012 88)", "oklch(0.52 0.17 295)", "oklch(0.84 0.16 85)"],
  },
  {
    value: "clay",
    label: "Clay",
    description: "Warm cream and terracotta",
    swatch: ["oklch(0.985 0.006 75)", "oklch(0.54 0.15 40)", "oklch(0.8 0.13 78)"],
  },
  {
    value: "signal",
    label: "Signal",
    description: "Paper and ink with signal orange",
    swatch: ["oklch(0.955 0.006 100)", "oklch(0.16 0 0)", "oklch(0.67 0.22 38)"],
  },
  {
    value: "sage",
    label: "Sage",
    description: "Soft greens, like a garden",
    swatch: ["oklch(0.985 0.006 145)", "oklch(0.54 0.11 155)", "oklch(0.8 0.13 115)"],
  },
  {
    value: "ocean",
    label: "Ocean",
    description: "Cool blues and sea glass",
    swatch: ["oklch(0.985 0.006 235)", "oklch(0.54 0.15 250)", "oklch(0.8 0.13 195)"],
  },
  {
    value: "plum",
    label: "Plum",
    description: "Dusky violet and rose",
    swatch: ["oklch(0.985 0.006 320)", "oklch(0.54 0.15 335)", "oklch(0.8 0.13 15)"],
  },
  {
    value: "slate",
    label: "Slate",
    description: "Quiet grays with indigo",
    swatch: ["oklch(0.985 0.006 255)", "oklch(0.54 0.17 275)", "oklch(0.8 0.13 300)"],
  },
] as const;

export const FONTS = [
  {
    value: "inter-tight",
    label: "Inter Tight",
    description: "Crisp and modern",
    family: "--font-inter-tight",
  },
  {
    value: "geist",
    label: "Geist",
    description: "Clean and geometric",
    family: "--font-geist-sans",
  },
  { value: "inter", label: "Inter", description: "Compact and neutral", family: "--font-inter" },
  {
    value: "serif",
    label: "Source Serif",
    description: "Classic, bookish serif",
    family: "--font-source-serif",
  },
  {
    value: "legible",
    label: "Atkinson Hyperlegible",
    description: "Designed for readability",
    family: "--font-atkinson",
  },
  { value: "system", label: "System", description: "Your device’s font", family: null },
] as const;

/** List density: comfortable (the default, no attribute) or compact, which tightens list rows. */
export const DENSITIES = [
  { value: "comfortable", label: "Comfortable", description: "Roomy rows with breathing space" },
  { value: "compact", label: "Compact", description: "Tighter rows, more on screen" },
] as const;

export type Palette = (typeof PALETTES)[number]["value"];
export type AppFont = (typeof FONTS)[number]["value"];
export type Density = (typeof DENSITIES)[number]["value"];

export const DEFAULT_PALETTE: Palette = "studio";
export const DEFAULT_FONT: AppFont = "inter-tight";
export const DEFAULT_DENSITY: Density = "comfortable";

export const PALETTE_STORAGE_KEY = "orbit:palette";
export const FONT_STORAGE_KEY = "orbit:font";
export const DENSITY_STORAGE_KEY = "orbit:density";

const PALETTE_VALUES: readonly string[] = PALETTES.map((palette) => palette.value);
const FONT_VALUES: readonly string[] = FONTS.map((font) => font.value);
const DENSITY_VALUES: readonly string[] = DENSITIES.map((density) => density.value);

function isPalette(value: string | undefined): value is Palette {
  return value !== undefined && PALETTE_VALUES.includes(value);
}

function isFont(value: string | undefined): value is AppFont {
  return value !== undefined && FONT_VALUES.includes(value);
}

function isDensity(value: string | undefined): value is Density {
  return value !== undefined && DENSITY_VALUES.includes(value);
}

/**
 * Inline script for the root layout's <head>: applies the saved choices before first paint. Only
 * known, non-default values are applied, so a stale or tampered entry falls back to the default.
 */
export const appearancePreferenceScript = `try{var d=document.documentElement,p=localStorage.getItem(${JSON.stringify(PALETTE_STORAGE_KEY)}),f=localStorage.getItem(${JSON.stringify(FONT_STORAGE_KEY)}),n=localStorage.getItem(${JSON.stringify(DENSITY_STORAGE_KEY)});if(${JSON.stringify(PALETTE_VALUES.filter((value) => value !== DEFAULT_PALETTE))}.indexOf(p)>=0)d.dataset.palette=p;if(${JSON.stringify(FONT_VALUES.filter((value) => value !== DEFAULT_FONT))}.indexOf(f)>=0)d.dataset.font=f;if(${JSON.stringify(DENSITY_VALUES.filter((value) => value !== DEFAULT_DENSITY))}.indexOf(n)>=0)d.dataset.density=n}catch(e){}`;

export function readPalette(root: HTMLElement = document.documentElement): Palette {
  const value = root.dataset.palette;
  return isPalette(value) ? value : DEFAULT_PALETTE;
}

export function readFont(root: HTMLElement = document.documentElement): AppFont {
  const value = root.dataset.font;
  return isFont(value) ? value : DEFAULT_FONT;
}

export function readDensity(root: HTMLElement = document.documentElement): Density {
  const value = root.dataset.density;
  return isDensity(value) ? value : DEFAULT_DENSITY;
}

export function writePalette(palette: Palette, root: HTMLElement = document.documentElement) {
  write(root, "palette", PALETTE_STORAGE_KEY, palette, palette === DEFAULT_PALETTE);
}

export function writeFont(font: AppFont, root: HTMLElement = document.documentElement) {
  write(root, "font", FONT_STORAGE_KEY, font, font === DEFAULT_FONT);
}

export function writeDensity(density: Density, root: HTMLElement = document.documentElement) {
  write(root, "density", DENSITY_STORAGE_KEY, density, density === DEFAULT_DENSITY);
}

function write(
  root: HTMLElement,
  attribute: "palette" | "font" | "density",
  key: string,
  value: string,
  isDefault: boolean,
) {
  if (isDefault) delete root.dataset[attribute];
  else root.dataset[attribute] = value;
  try {
    if (isDefault) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, blocked site data). The choice then lasts only
    // for this page view, which is an acceptable degradation.
  }
}
