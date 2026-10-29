"use client";

import { KeyRound, MailCheck } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";

import { FormAlert, FormField } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { AuthFailure } from "@/lib/auth/auth-client";
import { validateEmail } from "@/lib/auth/validation";

import { AuthCard, authLinkClassName } from "./auth-card";
import { useAuth } from "./auth-provider";
import { AuthErrorScreen, AuthLoadingScreen } from "./auth-status-screen";
import { useAuthRedirect } from "./use-auth-redirect";

export const backToSignIn = (
  <>
    Remembered it?{" "}
    <Link href="/sign-in" className={authLinkClassName}>
      Back to sign in
    </Link>
  </>
);

/** Local accounts have no email-based recovery: Orbit sends no email in local mode. */
export function LocalRecoveryUnavailable() {
  return (
    <AuthCard
      title="Password reset isn’t available"
      description="Your account is stored only on this computer, and Orbit doesn’t send email in local mode."
    >
      <div className="space-y-4">
        <div className="flex gap-3 rounded-lg border bg-background p-4 text-sm">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
          <p className="text-pretty text-muted-foreground">
            Try the passwords you usually use, or check your password manager for an entry saved for
            this address.
          </p>
        </div>
        <Link href="/sign-in" className={buttonVariants({ className: "w-full" })}>
          Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}

export function ForgotPasswordForm() {
  const { state, requestPasswordReset, retry } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useAuthRedirect(state, "/");

  if (state.status === "loading") return <AuthLoadingScreen compact label="Loading…" />;
  if (state.status === "error")
    return <AuthErrorScreen compact message={state.message} onRetry={retry} />;
  if (state.status === "signed-in") return <AuthLoadingScreen compact label="Opening Orbit…" />;
  if (state.config.provider === "local") return <LocalRecoveryUnavailable />;

  if (sentTo) {
    return (
      <AuthCard
        title="Check your email"
        description="Follow the link in the email to choose a new password."
        footer={backToSignIn}
      >
        <div className="space-y-4">
          <div role="status" className="flex gap-3 rounded-lg border bg-background p-4 text-sm">
            <MailCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
            <p className="text-pretty">
              If an account exists for <strong className="font-medium">{sentTo}</strong>, we sent it
              a password reset link. Open it on this device.
            </p>
          </div>
          <Button variant="outline" className="w-full" onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
        </div>
      </AuthCard>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fieldError = validateEmail(email);
    setError(fieldError);
    setFormError(null);
    if (fieldError) {
      inputRef.current?.focus();
      return;
    }
    setSubmitting(true);
    const address = email.trim();
    try {
      await requestPasswordReset(address);
      setSentTo(address);
    } catch (failure) {
      setFormError(
        failure instanceof AuthFailure
          ? failure.message
          : "Couldn’t send the reset link. Try again.",
      );
    }
    setSubmitting(false);
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email for your Orbit cloud account, and we’ll send you a reset link."
      footer={backToSignIn}
    >
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        <FormField
          ref={inputRef}
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={error}
        />
        <FormAlert message={formError} />
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Sending link…" : "Send reset link"}
        </Button>
      </form>
    </AuthCard>
  );
}
