"use client";

import { useSyncExternalStore } from "react";

import {
  type AppFont,
  type Palette,
  readFont,
  readPalette,
  writeFont,
  writePalette,
} from "@/lib/appearance-preference";

/** Keeps React in sync with the palette and font stored on `<html data-palette data-font>`. */
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

export function setPalette(palette: Palette) {
  writePalette(palette);
  notify();
}

export function setAppFont(font: AppFont) {
  writeFont(font);
  notify();
}
