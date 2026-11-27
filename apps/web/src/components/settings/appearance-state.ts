"use client";

import { useSyncExternalStore } from "react";

import {
  type AppFont,
  type Density,
  type Palette,
  readDensity,
  readFont,
  readPalette,
  writeDensity,
  writeFont,
  writePalette,
} from "@/lib/appearance-preference";

/** Keeps React in sync with the palette, font, and density stored on `<html data-palette data-font data-density>`. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

/** The stored choice is unknown on the server; callers show a placeholder until it's known. */
function getServerSnapshot() {
  return undefined;
}

export function usePalette(): Palette | undefined {
  return useSyncExternalStore(subscribe, () => readPalette(), getServerSnapshot);
}

export function useAppFont(): AppFont | undefined {
  return useSyncExternalStore(subscribe, () => readFont(), getServerSnapshot);
}

export function useDensity(): Density | undefined {
  return useSyncExternalStore(subscribe, () => readDensity(), getServerSnapshot);
}

export function setPalette(palette: Palette) {
  writePalette(palette);
  notify();
}

export function setAppFont(font: AppFont) {
  writeFont(font);
  notify();
}

export function setDensity(density: Density) {
  writeDensity(density);
  notify();
}
