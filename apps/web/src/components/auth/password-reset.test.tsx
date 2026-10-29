import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/providers/auth-provider";
import { ada, json, mockApi } from "@/test/api-mock";

import { ForgotPasswordForm } from "./forgot-password-form";
import { ResetPasswordForm } from "./reset-password-form";
import { SignInForm } from "./sign-in-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const supabaseAuth = vi.hoisted(() => ({
  getSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: supabaseAuth }) }));

const localConfig = json({ provider: "local", registration_open: false });
const cloudConfig = json({
  provider: "supabase",
  supabase_url: "https://project.supabase.co",
  supabase_publishable_key: "sb_publishable_test",
});

beforeEach(() => {
  supabaseAuth.getSession.mockResolvedValue({ data: { session: null } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

function renderWithAuth(ui: React.ReactNode) {
  render(<AuthProvider>{ui}</AuthProvider>);
}

/** A recovery session, as Supabase creates it from a valid reset link. */
function arriveWithRecoverySession() {
  supabaseAuth.getSession.mockResolvedValue({ data: { session: { access_token: "jwt" } } });
  mockApi({
    "GET /api/v1/auth/config": cloudConfig,
    "GET /api/v1/me": json({ ...ada, auth_provider: "supabase" }),
  });
}

describe("SignInForm", () => {
  it("links to password recovery", async () => {
    mockApi({ "GET /api/v1/auth/config": localConfig });
    renderWithAuth(<SignInForm next="/" />);

    expect(await screen.findByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });
});

describe("ForgotPasswordForm", () => {
  it("explains that local accounts can't be reset by email", async () => {
    mockApi({ "GET /api/v1/auth/config": localConfig });
    renderWithAuth(<ForgotPasswordForm />);

    expect(
      await screen.findByRole("heading", { name: "Password reset isn’t available" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("validates the email before sending anything", async () => {
    const user = userEvent.setup();
    mockApi({ "GET /api/v1/auth/config": cloudConfig });
    renderWithAuth(<ForgotPasswordForm />);

    await user.click(await screen.findByRole("button", { name: "Send reset link" }));

    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Enter your email address.");
    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(supabaseAuth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("sends a reset link without revealing whether the account exists", async () => {
    const user = userEvent.setup();
    supabaseAuth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    mockApi({ "GET /api/v1/auth/config": cloudConfig });
    renderWithAuth(<ForgotPasswordForm />);

    await user.type(await screen.findByLabelText("Email"), " ada@example.com ");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "If an account exists for ada@example.com",
    );
    expect(supabaseAuth.resetPasswordForEmail).toHaveBeenCalledWith(
      "ada@example.com",
      expect.anything(),
    );
  });

  it("shows a helpful error and lets the user try again", async () => {
    const user = userEvent.setup();
    supabaseAuth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { code: "over_email_send_rate_limit", status: 429, message: "rate limited" },
    });
    mockApi({ "GET /api/v1/auth/config": cloudConfig });
    renderWithAuth(<ForgotPasswordForm />);

    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many emails were sent.");
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeEnabled();
  });
});

describe("ResetPasswordForm", () => {
  it("offers a new link when the reset link is invalid or expired", async () => {
    mockApi({ "GET /api/v1/auth/config": cloudConfig });
    renderWithAuth(<ResetPasswordForm />);

    expect(
      await screen.findByRole("heading", { name: "This link has expired" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("requires matching passwords that meet the policy", async () => {
    const user = userEvent.setup();
    arriveWithRecoverySession();
    renderWithAuth(<ResetPasswordForm />);

    await user.type(await screen.findByLabelText("New password"), "long enough");
    await user.type(screen.getByLabelText("Confirm new password"), "long enougj");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(screen.getByLabelText("Confirm new password")).toHaveAccessibleDescription(
      "The passwords don’t match.",
    );
    expect(screen.getByLabelText("Confirm new password")).toHaveFocus();
    expect(supabaseAuth.updateUser).not.toHaveBeenCalled();
  });

  it("sets the new password for the account in the link", async () => {
    const user = userEvent.setup();
    supabaseAuth.updateUser.mockResolvedValue({ data: {}, error: null });
    arriveWithRecoverySession();
    renderWithAuth(<ResetPasswordForm />);

    expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
    await user.type(screen.getByLabelText("New password"), "long enough");
    await user.type(screen.getByLabelText("Confirm new password"), "long enough");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("heading", { name: "Password updated" })).toBeInTheDocument();
    expect(supabaseAuth.updateUser).toHaveBeenCalledWith({ password: "long enough" });
    expect(screen.getByRole("link", { name: "Continue to Orbit" })).toHaveAttribute("href", "/");
  });

  it("explains that local accounts can't be reset", async () => {
    mockApi({ "GET /api/v1/auth/config": localConfig });
    renderWithAuth(<ResetPasswordForm />);

    expect(
      await screen.findByRole("heading", { name: "Password reset isn’t available" }),
    ).toBeInTheDocument();
  });
});
