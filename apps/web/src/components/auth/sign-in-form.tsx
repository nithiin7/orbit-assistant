"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import Link from "next/link";
import { useForm } from "react-hook-form";

import { FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { AuthFailure } from "@/lib/auth/auth-client";
import { signInSchema } from "@/lib/auth/validation";
import { useAuth } from "@/providers/auth";

import { AuthCard, authLinkClassName } from "./auth-card";
import { AuthErrorScreen, AuthLoadingScreen } from "./auth-status-screen";
import { useAuthRedirect } from "./use-auth-redirect";

export function SignInForm({ next }: { next: string }) {
  const { state, signIn, retry } = useAuth();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });
  useAuthRedirect(state, next);

  if (state.status === "loading") return <AuthLoadingScreen compact label="Loading sign-in…" />;
  if (state.status === "error")
    return <AuthErrorScreen compact message={state.message} onRetry={retry} />;
  if (state.status === "signed-in") return <AuthLoadingScreen compact label="Signing you in…" />;

  const { config } = state;
  const canSignUp = config.provider === "supabase" || config.registration_open;

  const onSubmit = handleSubmit(async ({ email, password }) => {
    try {
      await signIn(email, password);
    } catch (error) {
      setError("root.server", {
        message:
          error instanceof AuthFailure ? error.message : "Sign-in failed. Try again in a moment.",
      });
    }
  });

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
      <form noValidate onSubmit={onSubmit} className="space-y-4">
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
          autoComplete="current-password"
          labelAction={
            <Link
              href="/forgot-password"
              className="rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Forgot password?
            </Link>
          }
          {...register("password")}
          error={errors.password?.message}
        />
        <FormAlert message={errors.root?.server?.message ?? null} />
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
