"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormAlert, FormField } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { AuthFailure } from "@/lib/auth/auth-client";
import { PASSWORD_MIN_LENGTH, signUpSchema } from "@/lib/auth/validation";

import { AuthCard, authLinkClassName } from "./auth-card";
import { useAuth } from "./auth-provider";
import { AuthErrorScreen, AuthLoadingScreen } from "./auth-status-screen";
import { useAuthRedirect } from "./use-auth-redirect";

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
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(signUpSchema),
    defaultValues: { displayName: "", email: "", password: "" },
  });
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);
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

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await signUp(values);
      if (result === "confirmation-required") setConfirmationSentTo(values.email);
    } catch (error) {
      setError("root.server", {
        message:
          error instanceof AuthFailure ? error.message : "Couldn’t create your account. Try again.",
      });
    }
  });

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
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        <FormField
          label="Name"
          autoComplete="name"
          {...register("displayName")}
          error={errors.displayName?.message}
        />
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          {...register("email")}
          error={errors.email?.message}
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          {...register("password")}
          error={errors.password?.message}
        />
        <FormAlert message={errors.root?.server?.message ?? null} />
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}
