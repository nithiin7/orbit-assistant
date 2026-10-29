"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { CircleCheck, Link2Off } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormAlert, FormField } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { AuthFailure } from "@/lib/auth/auth-client";
import { PASSWORD_MIN_LENGTH, passwordResetSchema } from "@/lib/auth/validation";

import { AuthCard } from "./auth-card";
import { useAuth } from "./auth-provider";
import { AuthErrorScreen, AuthLoadingScreen } from "./auth-status-screen";
import { backToSignIn, LocalRecoveryUnavailable } from "./forgot-password-form";

/**
 * The landing page of a Supabase reset email. Supabase reads the link and starts a recovery
 * session, so a valid link arrives here signed in; without a session, the link was invalid.
 */
export function ResetPasswordForm() {
  const { state, updatePassword, retry } = useAuth();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(passwordResetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const [done, setDone] = useState(false);

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

  const onSubmit = handleSubmit(async ({ password }) => {
    try {
      await updatePassword(password);
      setDone(true);
    } catch (error) {
      setError("root.server", {
        message:
          error instanceof AuthFailure
            ? error.message
            : "Couldn’t update your password. Try again.",
      });
    }
  });

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
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        <FormField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          {...register("password")}
          error={errors.password?.message}
        />
        <FormField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          {...register("confirmPassword")}
          error={errors.confirmPassword?.message}
        />
        <FormAlert message={errors.root?.server?.message ?? null} />
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Updating password…" : "Update password"}
        </Button>
      </form>
    </AuthCard>
  );
}
