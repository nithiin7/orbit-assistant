import {
  Atkinson_Hyperlegible_Next,
  Geist,
  Geist_Mono,
  Inter,
  Source_Serif_4,
} from "next/font/google";

/*
 * Fonts, self-hosted by next/font: the files are downloaded at build time and served from Orbit,
 * so browsers never contact Google. Geist is the default; the others are optional choices in
 * Settings → Appearance, so they aren't preloaded and browsers fetch them only when chosen. The
 * variables feed `--font-ui` in tokens.css and `--font-mono` in theme.css.
 */
const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  preload: false,
});
const serif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
  preload: false,
});
// next/font has no fallback metrics for this font yet, so it can't generate an adjusted fallback.
const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--font-atkinson",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

/** Classes for <html> that define the font variables. */
export const fontVariables = [sans, mono, inter, serif, atkinson]
  .map((font) => font.variable)
  .join(" ");
