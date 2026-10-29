import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, status } from "@/test/api-mock";

import {
  AuthFailure,
  createLocalAuthClient,
  createSupabaseAuthClient,
  describeSupabaseError,
} from "./auth-client";
import { readLocalSession, writeLocalSession } from "./local-session";

const supabaseAuth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  onAuthStateChange: vi.fn(),
}));
const createClient = vi.hoisted(() => vi.fn(() => ({ auth: supabaseAuth })));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

const session = {
  access_token: "issued-token",
  token_type: "bearer",
  expires_at: "2999-01-01T00:00:00Z",
  user: ada,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("local auth client", () => {
  it("stores the session issued at sign-in", async () => {
    const api = mockApi({ "POST /api/v1/auth/local/sign-in": json(session) });

    await createLocalAuthClient().signIn("ada@example.com", "correct horse");

    expect(api.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ email: "ada@example.com", password: "correct horse" }),
    );
    expect(readLocalSession()?.token).toBe("issued-token");
  });

  it("reports the API's sign-in error without storing anything", async () => {
    mockApi({
      "POST /api/v1/auth/local/sign-in": status(401, "The email or password is incorrect."),
    });

    await expect(createLocalAuthClient().signIn("ada@example.com", "nope")).rejects.toEqual(
      new AuthFailure("The email or password is incorrect."),
    );
    expect(readLocalSession()).toBeNull();
  });

  it("signs up with the display name", async () => {
    const api = mockApi({ "POST /api/v1/auth/local/sign-up": json(session, 201) });

    await expect(
      createLocalAuthClient().signUp({
        email: "ada@example.com",
        password: "correct horse",
        displayName: "Ada",
      }),
    ).resolves.toBe("signed-in");
    expect(JSON.parse(String(api.mock.calls[0]?.[1]?.body))).toEqual({
      email: "ada@example.com",
      password: "correct horse",
      display_name: "Ada",
    });
  });

  it("revokes the session on sign-out", async () => {
    writeLocalSession({ token: "stored", expiresAt: "2999-01-01T00:00:00Z" });
    const api = mockApi({ "POST /api/v1/auth/local/sign-out": status(204) });

    await createLocalAuthClient().signOut();

    expect(api).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/local/sign-out",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer stored" }) as unknown,
      }),
    );
    expect(readLocalSession()).toBeNull();
  });

  it("clears the session locally even when the API can't be reached", async () => {
    writeLocalSession({ token: "stored", expiresAt: "2999-01-01T00:00:00Z" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await createLocalAuthClient().signOut();

    expect(readLocalSession()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("can't reset passwords, since local mode sends no email", async () => {
    const api = mockApi({});
    const client = createLocalAuthClient();

    await expect(client.requestPasswordReset("ada@example.com")).rejects.toBeInstanceOf(
      AuthFailure,
    );
    await expect(client.updatePassword("long enough")).rejects.toBeInstanceOf(AuthFailure);
    expect(api).not.toHaveBeenCalled();
  });

  it("notices sign-in and sign-out in other tabs", () => {
    const listener = vi.fn();
    const unsubscribe = createLocalAuthClient().subscribe(listener);

    window.dispatchEvent(new StorageEvent("storage", { key: "orbit:session" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "orbit:sidebar" }));
    unsubscribe();
    window.dispatchEvent(new StorageEvent("storage", { key: "orbit:session" }));

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("Supabase auth client", () => {
  const config = {
    provider: "supabase",
    supabase_url: "https://project.supabase.co",
    supabase_publishable_key: "sb_publishable_test",
  } as const;

  beforeEach(() => {
    supabaseAuth.signOut.mockResolvedValue({ error: null });
  });

  it("uses only the public project settings", async () => {
    await createSupabaseAuthClient(config);

    expect(createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "sb_publishable_test",
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: true }) as unknown,
      }),
    );
  });

  it("returns the current access token", async () => {
    supabaseAuth.getSession.mockResolvedValue({ data: { session: { access_token: "jwt" } } });
    const client = await createSupabaseAuthClient(config);

    await expect(client.getToken()).resolves.toBe("jwt");
  });

  it("reports when email confirmation is required", async () => {
    supabaseAuth.signUp.mockResolvedValue({ data: { session: null, user: {} }, error: null });
    const client = await createSupabaseAuthClient(config);

    const result = await client.signUp({
      email: "ada@example.com",
      password: "correct horse",
      displayName: "Ada",
    });

    expect(result).toBe("confirmation-required");
    expect(supabaseAuth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ data: { display_name: "Ada" } }) as unknown,
      }),
    );
  });

  it("maps Supabase errors to helpful messages", async () => {
    supabaseAuth.signInWithPassword.mockResolvedValue({
      error: { code: "invalid_credentials", status: 400, message: "Invalid login credentials" },
    });
    const client = await createSupabaseAuthClient(config);

    await expect(client.signIn("ada@example.com", "nope")).rejects.toEqual(
      new AuthFailure("The email or password is incorrect."),
    );
  });

  it("sends reset links back to the reset page on this origin", async () => {
    supabaseAuth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    const client = await createSupabaseAuthClient(config);

    await client.requestPasswordReset("ada@example.com");

    expect(supabaseAuth.resetPasswordForEmail).toHaveBeenCalledWith("ada@example.com", {
      redirectTo: `${window.location.origin}/reset-password`,
    });
  });

  it("updates the password and explains a rejected one", async () => {
    supabaseAuth.updateUser.mockResolvedValueOnce({ data: {}, error: null });
    supabaseAuth.updateUser.mockResolvedValueOnce({
      data: {},
      error: { code: "same_password", status: 422, message: "New password should be different." },
    });
    const client = await createSupabaseAuthClient(config);

    await client.updatePassword("long enough");
    expect(supabaseAuth.updateUser).toHaveBeenCalledWith({ password: "long enough" });
    await expect(client.updatePassword("long enough")).rejects.toEqual(
      new AuthFailure("Choose a password that’s different from your current one."),
    );
  });

  it("signs out of this browser only", async () => {
    const client = await createSupabaseAuthClient(config);

    await client.signOut();

    expect(supabaseAuth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

describe("describeSupabaseError", () => {
  it.each([
    [{ code: "email_not_confirmed", status: 400 }, /Confirm your email/],
    [{ code: "weak_password", status: 422, message: "Password needs a digit." }, /needs a digit/],
    [{ status: 429 }, /Too many attempts/],
    [{ status: 0 }, /Can’t reach the sign-in service/],
    [{ code: "unexpected_failure", status: 500, message: "stack trace…" }, /^Fallback$/],
  ])("%j", (error, expected) => {
    expect(describeSupabaseError(error, "Fallback")).toMatch(expected);
  });
});
