import { Geist, Geist_Mono } from "next/font/google";

/*
 * Geist, self-hosted by next/font: the files are downloaded at build time and served from Orbit,
 * so browsers never contact Google. The variables feed `--font-sans` and `--font-mono` in theme.css.
 */
const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

/** Classes for <html> that define the font variables. */
export const fontVariables = `${sans.variable} ${mono.variable}`;
