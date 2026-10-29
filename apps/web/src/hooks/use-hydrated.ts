"use client";

import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

/**
 * False during server rendering and hydration, true afterwards. Use it to defer UI that depends on
 * browser-only state (such as the stored theme) without causing a hydration mismatch.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
