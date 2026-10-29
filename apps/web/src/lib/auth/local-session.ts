/**
 * Persistence for local-mode sessions. The token is an opaque bearer credential issued by the
 * API, which stores only its hash and can revoke it. It is kept in localStorage so the session
 * survives reloads; like Supabase's own client, this means scripts on the page can read it.
 */

export const LOCAL_SESSION_KEY = "orbit:session";

export type StoredSession = { token: string; expiresAt: string };

export function readLocalSession(now: Date = new Date()): StoredSession | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LOCAL_SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearLocalSession();
    return null;
  }
  if (!isStoredSession(parsed) || !(Date.parse(parsed.expiresAt) > now.getTime())) {
    clearLocalSession();
    return null;
  }
  return parsed;
}

export function writeLocalSession(session: StoredSession): void {
  try {
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage can be unavailable (private mode, blocked site data). The session then lasts
    // only for this page view.
  }
}

export function clearLocalSession(): void {
  try {
    localStorage.removeItem(LOCAL_SESSION_KEY);
  } catch {
    // Nothing stored, or storage unavailable; either way there is nothing to clear.
  }
}

function isStoredSession(value: unknown): value is StoredSession {
  return (
    typeof value === "object" &&
    value !== null &&
    "token" in value &&
    "expiresAt" in value &&
    typeof value.token === "string" &&
    value.token.length > 0 &&
    typeof value.expiresAt === "string"
  );
}
