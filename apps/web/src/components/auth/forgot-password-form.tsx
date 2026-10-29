"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { KeyRound, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormAlert, FormField } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { AuthFailure } from "@/lib/auth/auth-client";
import { forgotPasswordSchema } from "@/lib/auth/validation";
import { useAuth } from "@/providers/auth";

import { AuthCard, authLinkClassName } from "./auth-card";
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
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: yupResolver(forgotPasswordSchema), defaultValues: { email: "" } });
  const [sentTo, setSentTo] = useState<string | null>(null);
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

  const onSubmit = handleSubmit(async ({ email }) => {
    try {
      await requestPasswordReset(email);
      setSentTo(email);
    } catch (failure) {
      setError("root.server", {
        message:
          failure instanceof AuthFailure
            ? failure.message
            : "Couldn’t send the reset link. Try again.",
      });
    }
  });

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email for your Orbit cloud account, and we’ll send you a reset link."
      footer={backToSignIn}
    >
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          {...register("email")}
          error={errors.email?.message}
        />
        <FormAlert message={errors.root?.server?.message ?? null} />
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Sending link…" : "Send reset link"}
        </Button>
      </form>
    </AuthCard>
  );
}
