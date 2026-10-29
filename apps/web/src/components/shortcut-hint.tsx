"use client";

import { useSyncExternalStore } from "react";

import { Kbd } from "@/components/ui/kbd";
import { isMacPlatform } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

function subscribe() {
  return () => {};
}

/** Whether the user is on an Apple platform; `null` during server rendering and hydration. */
export function useIsMac(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => isMacPlatform(navigator.userAgent),
    () => null,
  );
}

type ShortcutHintProps = {
  /** The letter pressed with the platform modifier (Cmd on macOS, Ctrl elsewhere). */
  keyName: string;
  className?: string;
};

/** A mod shortcut for the current platform. Decorative: pair it with `aria-keyshortcuts`. */
export function ShortcutHint({ keyName, className }: ShortcutHintProps) {
  const isMac = useIsMac();
  if (isMac === null) return null;

  return (
    <span aria-hidden="true" className={cn("inline-flex items-center gap-0.5", className)}>
      <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
      <Kbd>{keyName.toUpperCase()}</Kbd>
    </span>
  );
}
