"use client";

import type { AuthConfig, UserProfile } from "@orbit/contracts";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getAuthConfig } from "@/api/auth";
import { ApiError, describeApiError } from "@/api/client";
import { getMe } from "@/api/profile";
import {
  type AuthClient,
  createAuthClient,
  type SignUpInput,
  type SignUpResult,
} from "@/lib/auth/auth-client";

export type AuthState =
  | { status: "loading" }
  /** Sign-in settings or the session couldn't be checked (for example, the API is down). */
  | { status: "error"; message: string }
  | { status: "signed-out"; config: AuthConfig }
  | { status: "signed-in"; config: AuthConfig; user: UserProfile };

type AuthContextValue = {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  retry: () => void;
  /** Run an API call with the current token. A 401 response signs the user out. */
  withToken: <T>(call: (token: string) => Promise<T>) => Promise<T>;
  /** Replace the signed-in user's profile after the API confirmed a change. */
  setUser: (user: UserProfile) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}

/** The signed-in user. Only for components rendered behind `RequireAuth`. */
export function useCurrentUser(): UserProfile {
  const { state } = useAuth();
  if (state.status !== "signed-in") throw new Error("useCurrentUser requires a signed-in user.");
  return state.user;
}

const notSignedIn = () => new ApiError(401, "", "Sign in to continue.");

/**
 * Owns the browser's session: loads the sign-in configuration from the API, restores a stored
 * session, and confirms it with `GET /api/v1/me` before treating the user as signed in.
 *
 * This only decides what the UI shows. The API validates the token on every request and is the
 * security boundary; no page renders private data without it.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const clientRef = useRef<AuthClient | null>(null);
  const configRef = useRef<AuthConfig | null>(null);
  // Each session check takes a number; only the latest may update state, so a slow, stale
  // response can never overwrite a newer sign-in or sign-out.
  const generation = useRef(0);

  const signedOut = useCallback(() => {
    generation.current += 1;
    const config = configRef.current;
    setState(config ? { status: "signed-out", config } : { status: "loading" });
  }, []);

  const resolveSession = useCallback(async () => {
    const run = ++generation.current;
    const isCurrent = () => run === generation.current;
    const client = clientRef.current;
    const config = configRef.current;
    if (!client || !config) return;

    try {
      const token = await client.getToken();
      if (!token) {
        if (isCurrent()) setState({ status: "signed-out", config });
        return;
      }
      const user = await getMe(token);
      if (isCurrent()) setState({ status: "signed-in", config, user });
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof ApiError && error.status === 401) {
        await client.discardSession();
        if (isCurrent()) setState({ status: "signed-out", config });
        return;
      }
      // Keep the stored session: a transient outage shouldn't sign anyone out.
      setState({
        status: "error",
        message: describeApiError(error, "Couldn’t check your session. Try again."),
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};

    void (async () => {
      try {
        const config = await getAuthConfig();
        const client = await createAuthClient(config);
        if (cancelled) return;
        configRef.current = config;
        clientRef.current = client;
        unsubscribe = client.subscribe(() => void resolveSession());
        await resolveSession();
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: describeApiError(error, "Couldn’t load Orbit’s sign-in settings."),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      generation.current += 1;
      unsubscribe();
    };
  }, [attempt, resolveSession]);

  const requireClient = useCallback(() => {
    const client = clientRef.current;
    if (!client) throw new Error("Sign-in is not ready yet.");
    return client;
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await requireClient().signIn(email, password);
      await resolveSession();
    },
    [requireClient, resolveSession],
  );

  const signUp = useCallback(
    async (input: SignUpInput) => {
      const result = await requireClient().signUp(input);
      if (result === "signed-in") await resolveSession();
      return result;
    },
    [requireClient, resolveSession],
  );

  const signOut = useCallback(async () => {
    await requireClient().signOut();
    signedOut();
  }, [requireClient, signedOut]);

  const requestPasswordReset = useCallback(
    (email: string) => requireClient().requestPasswordReset(email),
    [requireClient],
  );

  const updatePassword = useCallback(
    (password: string) => requireClient().updatePassword(password),
    [requireClient],
  );

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  const withToken = useCallback(
    async function withToken<T>(call: (token: string) => Promise<T>): Promise<T> {
      const client = clientRef.current;
      const token = client ? await client.getToken() : null;
      if (!client || !token) {
        signedOut();
        throw notSignedIn();
      }
      try {
        return await call(token);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await client.discardSession();
          signedOut();
        }
        throw error;
      }
    },
    [signedOut],
  );

  const setUser = useCallback((user: UserProfile) => {
    setState((current) => (current.status === "signed-in" ? { ...current, user } : current));
  }, []);

  const value = useMemo(
    () => ({
      state,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
      retry,
      withToken,
      setUser,
    }),
    [
      state,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
      retry,
      withToken,
      setUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
