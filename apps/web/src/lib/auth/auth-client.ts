import type { AuthConfig, SupabaseAuthConfig } from "@orbit/contracts";

import { ApiError, describeApiError, localSignIn, localSignOut, localSignUp } from "../api";
import {
  clearLocalSession,
  LOCAL_SESSION_KEY,
  readLocalSession,
  writeLocalSession,
} from "./local-session";

/** A sign-in failure with a message written for the user. */
export class AuthFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthFailure";
  }
}

export type SignUpInput = { email: string; password: string; displayName: string };

/** `confirmation-required`: Supabase sent a confirmation email; there is no session yet. */
export type SignUpResult = "signed-in" | "confirmation-required";

/**
 * One interface over both identity providers. The API decides which applies (local accounts
 * in local mode, Supabase Auth in cloud mode); the web app never chooses.
 */
export interface AuthClient {
  readonly provider: AuthConfig["provider"];
  /** The current bearer token for API requests, or null when signed out. */
  getToken(): Promise<string | null>;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: SignUpInput): Promise<SignUpResult>;
  /** End the session. Local state is always cleared, even if the server can't be reached. */
  signOut(): Promise<void>;
  /** Drop a session the API rejected, without contacting the server. */
  discardSession(): Promise<void>;
  /** Email a password reset link. Cloud accounts only; Orbit sends no email in local mode. */
  requestPasswordReset(email: string): Promise<void>;
  /** Set a new password for the signed-in user (after following a reset link). Cloud only. */
  updatePassword(password: string): Promise<void>;
  /** Notified when the session changes outside this tab's actions (other tabs, expiry). */
  subscribe(listener: () => void): () => void;
}

export async function createAuthClient(config: AuthConfig): Promise<AuthClient> {
  if (config.provider === "supabase") return createSupabaseAuthClient(config);
  return createLocalAuthClient();
}

export function createLocalAuthClient(): AuthClient {
  const remember = (session: { access_token: string; expires_at: string }) =>
    writeLocalSession({ token: session.access_token, expiresAt: session.expires_at });

  return {
    provider: "local",
    getToken: () => Promise.resolve(readLocalSession()?.token ?? null),
    async signIn(email, password) {
      try {
        remember(await localSignIn({ email, password }));
      } catch (error) {
        throw new AuthFailure(describeApiError(error, "Sign-in failed. Try again."));
      }
    },
    async signUp({ email, password, displayName }) {
      try {
        remember(await localSignUp({ email, password, display_name: displayName }));
      } catch (error) {
        throw new AuthFailure(describeApiError(error, "Couldn’t create your account. Try again."));
      }
      return "signed-in";
    },
    async signOut() {
      const token = readLocalSession()?.token;
      clearLocalSession();
      if (!token) return;
      try {
        await localSignOut(token);
      } catch (error) {
        // The session is already gone from this browser. If the API was unreachable, the
        // server-side session expires on its own; an already-revoked session (401) is fine.
        if (!(error instanceof ApiError) || error.status !== 401) {
          console.warn("Couldn’t revoke the session on the server.", error);
        }
      }
    },
    discardSession() {
      clearLocalSession();
      return Promise.resolve();
    },
    requestPasswordReset: localRecoveryUnavailable,
    updatePassword: localRecoveryUnavailable,
    subscribe(listener) {
      const onStorage = (event: StorageEvent) => {
        if (event.key === LOCAL_SESSION_KEY || event.key === null) listener();
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
  };
}

function localRecoveryUnavailable(): Promise<never> {
  return Promise.reject(
    new AuthFailure("Password reset isn’t available for accounts stored on this computer."),
  );
}

/** Where Supabase sends people from a password reset email. Add it to the redirect allow list. */
export const RESET_PASSWORD_PATH = "/reset-password";

const SUPABASE_STORAGE_KEY = "orbit:supabase-auth";

const supabaseMessages: Record<string, string> = {
  invalid_credentials: "The email or password is incorrect.",
  email_not_confirmed: "Confirm your email address first, using the link we sent you.",
  user_already_exists: "An account with this email already exists. Sign in instead.",
  email_exists: "An account with this email already exists. Sign in instead.",
  signup_disabled: "New accounts can’t be created right now.",
  email_address_invalid: "Enter a valid email address.",
  over_request_rate_limit: "Too many attempts. Wait a moment, then try again.",
  over_email_send_rate_limit: "Too many emails were sent. Wait a few minutes, then try again.",
  same_password: "Choose a password that’s different from your current one.",
  session_not_found: "Your reset link has expired. Request a new one.",
  reauthentication_needed: "For your security, request a new reset link and try again.",
};

/** A user-facing message for a Supabase Auth error, never echoing raw server text. */
export function describeSupabaseError(
  error: { code?: string; status?: number; message?: string },
  fallback: string,
): string {
  if (error.code && error.code in supabaseMessages) return supabaseMessages[error.code] ?? fallback;
  // Password policy is configured in Supabase; its message explains what is missing.
  if (error.code === "weak_password" && error.message) return error.message;
  if (error.status === 429) return supabaseMessages.over_request_rate_limit ?? fallback;
  if (error.status === undefined || error.status === 0) {
    return "Can’t reach the sign-in service. Check your connection, then try again.";
  }
  return fallback;
}

export async function createSupabaseAuthClient(config: SupabaseAuthConfig): Promise<AuthClient> {
  // Loaded only in cloud mode, so local installations never download it.
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(config.supabase_url, config.supabase_publishable_key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: SUPABASE_STORAGE_KEY,
    },
  });

  return {
    provider: "supabase",
    async getToken() {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new AuthFailure(describeSupabaseError(error, "Sign-in failed. Try again."));
    },
    async signUp({ email, password, displayName }) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Used once, as the initial display name of the Orbit profile.
          data: { display_name: displayName },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) {
        throw new AuthFailure(describeSupabaseError(error, "Couldn’t create your account."));
      }
      return data.session ? "signed-in" : "confirmation-required";
    },
    async signOut() {
      // `local` ends this browser's session only, not the user's other devices.
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) console.warn("Couldn’t revoke the session with Supabase.", error);
    },
    async discardSession() {
      await supabase.auth.signOut({ scope: "local" });
    },
    async requestPasswordReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${RESET_PASSWORD_PATH}`,
      });
      if (error) {
        throw new AuthFailure(describeSupabaseError(error, "Couldn’t send the reset link."));
      }
    },
    async updatePassword(password) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        throw new AuthFailure(describeSupabaseError(error, "Couldn’t update your password."));
      }
    },
    subscribe(listener) {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        // Token refreshes don't change who is signed in; ignore them and the initial event.
        if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
          // Deferred: calling Supabase from inside this callback can deadlock its auth lock.
          setTimeout(listener, 0);
        }
      });
      return () => data.subscription.unsubscribe();
    },
  };
}
