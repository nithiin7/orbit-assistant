"use client";

import { useSyncExternalStore } from "react";

import { readSidebarCollapsed, writeSidebarCollapsed } from "@/lib/sidebar-preference";

/** Keeps React in sync with the sidebar preference stored on `<html data-sidebar>`. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot() {
  return false;
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, () => readSidebarCollapsed(), getServerSnapshot);
}

export function setSidebarCollapsed(collapsed: boolean) {
  writeSidebarCollapsed(collapsed);
  for (const listener of listeners) listener();
}
