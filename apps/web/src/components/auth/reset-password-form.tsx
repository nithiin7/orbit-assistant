"use client";

import { CircleCheck, Link2Off } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";

import { focusFirstInvalid, FormAlert, FormField } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { AuthFailure } from "@/lib/auth/auth-client";
import {
  type FieldErrors,
  hasErrors,
  PASSWORD_MIN_LENGTH,
  validatePasswordReset,
} from "@/lib/auth/validation";

import { AuthCard } from "./auth-card";
import { useAuth } from "./auth-provider";
import { AuthErrorScreen, AuthLoadingScreen } from "./auth-status-screen";
import { backToSignIn, LocalRecoveryUnavailable } from "./forgot-password-form";

type Field = "password" | "confirmPassword";

/**
 * The landing page of a Supabase reset email. Supabase reads the link and starts a recovery
 * session, so a valid link arrives here signed in; without a session, the link was invalid.
 */
export function ResetPasswordForm() {
  const { state, updatePassword, retry } = useAuth();
  const [values, setValues] = useState({ password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (state.status === "loading") return <AuthLoadingScreen compact label="Checking your link…" />;
  if (state.status === "error")
    return <AuthErrorScreen compact message={state.message} onRetry={retry} />;
  if (state.config.provider === "local") return <LocalRecoveryUnavailable />;

  if (done) {
    return (
      <AuthCard
        title="Password updated"
        description="Use your new password the next time you sign in."
      >
        <div className="space-y-4">
          <div role="status" className="flex gap-3 rounded-lg border bg-background p-4 text-sm">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
            <p className="text-pretty">Your password was changed, and you’re signed in.</p>
          </div>
          <Link href="/" className={buttonVariants({ className: "w-full" })}>
            Continue to Orbit
          </Link>
        </div>
      </AuthCard>
    );
  }

  if (state.status === "signed-out") {
    return (
      <AuthCard
        title="This link has expired"
        description="Reset links work once and expire after a while. Request a new one to continue."
        footer={backToSignIn}
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-lg border bg-background p-4 text-sm">
            <Link2Off className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-pretty text-muted-foreground">
              Open the newest email from Orbit, on the same device you requested it from.
            </p>
          </div>
          <Link href="/forgot-password" className={buttonVariants({ className: "w-full" })}>
            Request a new link
          </Link>
        </div>
      </AuthCard>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fieldErrors = validatePasswordReset(values);
    setErrors(fieldErrors);
    setFormError(null);
    if (hasErrors(fieldErrors)) {
      focusFirstInvalid(formRef.current, fieldErrors, {
        password: "password",
        confirmPassword: "confirm-password",
      });
      return;
    }
    setSubmitting(true);
    try {
      await updatePassword(values.password);
      setDone(true);
    } catch (error) {
      setFormError(
        error instanceof AuthFailure ? error.message : "Couldn’t update your password. Try again.",
      );
    }
    setSubmitting(false);
  }

  return (
    <AuthCard
      title="Choose a new password"
      description={
        <>
          For <strong className="font-medium text-foreground">{state.user.email}</strong>
        </>
      }
      footer={backToSignIn}
    >
      <form ref={formRef} noValidate onSubmit={onSubmit} className="space-y-4">
        <FormField
          label="New password"
          type="password"
          name="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          value={values.password}
          onChange={(event) => setValues({ ...values, password: event.target.value })}
          error={errors.password}
        />
        <FormField
          label="Confirm new password"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          value={values.confirmPassword}
          onChange={(event) => setValues({ ...values, confirmPassword: event.target.value })}
          error={errors.confirmPassword}
        />
        <FormAlert message={formError} />
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Updating password…" : "Update password"}
        </Button>
      </form>
    </AuthCard>
  );
}
