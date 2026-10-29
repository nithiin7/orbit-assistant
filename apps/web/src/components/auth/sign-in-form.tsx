"use client";

import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";

import { focusFirstInvalid, FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { AuthFailure } from "@/lib/auth/auth-client";
import { type FieldErrors, hasErrors, validateSignIn } from "@/lib/auth/validation";

import { AuthCard, authLinkClassName } from "./auth-card";
import { useAuth } from "./auth-provider";
import { AuthErrorScreen, AuthLoadingScreen } from "./auth-status-screen";
import { useAuthRedirect } from "./use-auth-redirect";

type Field = "email" | "password";

export function SignInForm({ next }: { next: string }) {
  const { state, signIn, retry } = useAuth();
  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useAuthRedirect(state, next);

  if (state.status === "loading") return <AuthLoadingScreen compact label="Loading sign-in…" />;
  if (state.status === "error")
    return <AuthErrorScreen compact message={state.message} onRetry={retry} />;
  if (state.status === "signed-in") return <AuthLoadingScreen compact label="Signing you in…" />;

  const { config } = state;
  const canSignUp = config.provider === "supabase" || config.registration_open;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fieldErrors = validateSignIn(values);
    setErrors(fieldErrors);
    setFormError(null);
    if (hasErrors(fieldErrors)) {
      focusFirstInvalid(formRef.current, fieldErrors, { email: "email", password: "password" });
      return;
    }
    setSubmitting(true);
    try {
      await signIn(values.email.trim(), values.password);
    } catch (error) {
      setFormError(
        error instanceof AuthFailure ? error.message : "Sign-in failed. Try again in a moment.",
      );
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Sign in to Orbit"
      description={
        config.provider === "local"
          ? "Use the account stored on this computer."
          : "Use your Orbit cloud account."
      }
      footer={
        canSignUp ? (
          <>
            New to Orbit?{" "}
            <Link href="/sign-up" className={authLinkClassName}>
              Create an account
            </Link>
          </>
        ) : null
      }
    >
      <form ref={formRef} noValidate onSubmit={onSubmit} className="space-y-4">
        <FormField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={values.email}
          onChange={(event) => setValues({ ...values, email: event.target.value })}
          error={errors.email}
        />
        <FormField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          labelAction={
            <Link
              href="/forgot-password"
              className="rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Forgot password?
            </Link>
          }
          value={values.password}
          onChange={(event) => setValues({ ...values, password: event.target.value })}
          error={errors.password}
        />
        <FormAlert message={formError} />
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
