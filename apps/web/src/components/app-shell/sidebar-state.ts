"use client";

import { useSyncExternalStore } from "react";

import { type NavPreference, readNavPreference, writeNavPreference } from "@/lib/nav-preference";
import type { NavGroupId } from "@/lib/navigation";
import { readSidebarCollapsed, writeSidebarCollapsed } from "@/lib/sidebar-preference";

/** Keeps React in sync with the sidebar preferences stored on `<html>`. */
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

function getServerSnapshot() {
  return false;
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, () => readSidebarCollapsed(), getServerSnapshot);
}

export function setSidebarCollapsed(collapsed: boolean) {
  writeSidebarCollapsed(collapsed);
  notify();
}

/** The server can't see the saved preference; the head script's CSS covers the first paint. */
const SERVER_NAV_PREFERENCE: NavPreference = { hidden: [], folded: [] };

export function useNavPreference(): NavPreference {
  return useSyncExternalStore(
    subscribe,
    () => readNavPreference(),
    () => SERVER_NAV_PREFERENCE,
  );
}

function toggle<T>(values: readonly T[], value: T, on: boolean): T[] {
  const rest = values.filter((item) => item !== value);
  return on ? [...rest, value] : rest;
}

export function setNavItemHidden(key: string, hidden: boolean) {
  const current = readNavPreference();
  writeNavPreference({ ...current, hidden: toggle(current.hidden, key, hidden) });
  notify();
}

export function setNavGroupFolded(id: NavGroupId, folded: boolean) {
  const current = readNavPreference();
  writeNavPreference({ ...current, folded: toggle(current.folded, id, folded) });
  notify();
}

/** Shows every link and unfolds every section. */
export function resetNavPreference() {
  writeNavPreference({ hidden: [], folded: [] });
  notify();
}
