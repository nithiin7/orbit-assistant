export function isMacPlatform(userAgent: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(userAgent);
}

/** True for a platform "mod" shortcut with no other modifiers: Cmd+key on macOS, Ctrl+key elsewhere. */
export function matchesModShortcut(event: KeyboardEvent, key: string, isMac: boolean): boolean {
  if (event.key.toLowerCase() !== key.toLowerCase() || event.altKey || event.shiftKey) return false;
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** The `aria-keyshortcuts` value for a mod shortcut, e.g. "Meta+K" or "Control+K". */
export function modKeyShortcut(key: string, isMac: boolean | null): string {
  return `${isMac ? "Meta" : "Control"}+${key.toUpperCase()}`;
}

/** A short visible label for a mod shortcut, e.g. "⌘B" or "Ctrl+B". */
export function modKeyLabel(key: string, isMac: boolean): string {
  return isMac ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`;
}

/** True when the event comes from a field where the user is typing text. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}
