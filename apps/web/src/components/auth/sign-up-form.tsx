"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";

import { focusFirstInvalid, FormAlert, FormField } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { AuthFailure } from "@/lib/auth/auth-client";
import {
  type FieldErrors,
  hasErrors,
  PASSWORD_MIN_LENGTH,
  validateSignUp,
} from "@/lib/auth/validation";

import { AuthCard, authLinkClassName } from "./auth-card";
import { useAuth } from "./auth-provider";
import { AuthErrorScreen, AuthLoadingScreen } from "./auth-status-screen";
import { useAuthRedirect } from "./use-auth-redirect";

type Field = "displayName" | "email" | "password";

const signInFooter = (
  <>
    Already have an account?{" "}
    <Link href="/sign-in" className={authLinkClassName}>
      Sign in
    </Link>
  </>
);

export function SignUpForm() {
  const { state, signUp, retry } = useAuth();
  const [values, setValues] = useState({ displayName: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useAuthRedirect(state, "/");

  if (state.status === "loading") return <AuthLoadingScreen compact label="Loading sign-up…" />;
  if (state.status === "error")
    return <AuthErrorScreen compact message={state.message} onRetry={retry} />;
  if (state.status === "signed-in") return <AuthLoadingScreen compact label="Opening Orbit…" />;

  const { config } = state;

  if (confirmationSentTo) {
    return (
      <AuthCard
        title="Check your email"
        description="Confirm your address to finish creating your account."
        footer={signInFooter}
      >
        <div role="status" className="flex gap-3 rounded-lg border bg-background p-4 text-sm">
          <MailCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
          <p className="text-pretty">
            We sent a confirmation link to{" "}
            <strong className="font-medium">{confirmationSentTo}</strong>. Open it on this device to
            sign in.
          </p>
        </div>
      </AuthCard>
    );
  }

  if (config.provider === "local" && !config.registration_open) {
    return (
      <AuthCard
        title="Sign-up is closed"
        description="This Orbit installation doesn’t accept new accounts. Sign in with an existing one instead."
      >
        <Link href="/sign-in" className={buttonVariants({ className: "w-full" })}>
          Go to sign in
        </Link>
      </AuthCard>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fieldErrors = validateSignUp(values);
    setErrors(fieldErrors);
    setFormError(null);
    if (hasErrors(fieldErrors)) {
      focusFirstInvalid(formRef.current, fieldErrors, {
        displayName: "name",
        email: "email",
        password: "password",
      });
      return;
    }
    setSubmitting(true);
    const email = values.email.trim();
    try {
      const result = await signUp({
        email,
        password: values.password,
        displayName: values.displayName.trim(),
      });
      if (result === "confirmation-required") setConfirmationSentTo(email);
    } catch (error) {
      setFormError(
        error instanceof AuthFailure ? error.message : "Couldn’t create your account. Try again.",
      );
    }
    setSubmitting(false);
  }

  return (
    <AuthCard
      title="Create your Orbit account"
      description={
        config.provider === "local"
          ? "Your account and data are stored on this computer."
          : "Your account is managed with Supabase, and your data is stored in Orbit’s cloud database."
      }
      footer={signInFooter}
    >
      <form ref={formRef} noValidate onSubmit={onSubmit} className="space-y-4">
        <FormField
          label="Name"
          name="name"
          autoComplete="name"
          value={values.displayName}
          onChange={(event) => setValues({ ...values, displayName: event.target.value })}
          error={errors.displayName}
        />
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
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          value={values.password}
          onChange={(event) => setValues({ ...values, password: event.target.value })}
          error={errors.password}
        />
        <FormAlert message={formError} />
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}
