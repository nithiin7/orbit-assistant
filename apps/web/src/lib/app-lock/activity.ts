/**
 * Idle tracking shared by every tab of Orbit in this browser. A tab records the person's last
 * input in localStorage so another tab doesn't lock while they are busy here, and announces
 * locking and unlocking so every tab follows.
 */

export const ACTIVITY_KEY = "orbit:app-lock:activity";
export const EVENT_KEY = "orbit:app-lock:event";

/** Write the shared activity time at most this often. */
export const SHARE_ACTIVITY_MS = 5_000;
/** Tell the API about activity at most this often (it allows a 20-second grace). */
export const HEARTBEAT_MS = 15_000;
/** How often a tab checks whether it has been idle long enough to lock. */
export const IDLE_CHECK_MS = 5_000;

export type LockEvent = "locked" | "unlocked";

export function readSharedActivity(): number | null {
  try {
    const value = Number(localStorage.getItem(ACTIVITY_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function shareActivity(at: number): void {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(at));
  } catch {
    // Storage is unavailable (for example, a private window): this tab still tracks itself.
  }
}

/** Tell the other tabs; each write differs so it always fires their `storage` event. */
export function announceLockEvent(event: LockEvent): void {
  try {
    localStorage.setItem(EVENT_KEY, `${event}:${Date.now()}`);
  } catch {
    // As above: other tabs find out from the API on their next request.
  }
}

export function parseLockEvent(value: string | null): LockEvent | null {
  const event = value?.split(":")[0];
  return event === "locked" || event === "unlocked" ? event : null;
}

/** Whether a tab whose person was last active at `lastActive` should lock at `now`. */
export function isIdle(lastActive: number, now: number, lockAfterMinutes: number): boolean {
  return now - lastActive >= lockAfterMinutes * 60_000;
}
