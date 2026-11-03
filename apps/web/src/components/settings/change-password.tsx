"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { changeLocalPassword } from "@/api/auth";
import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { changePasswordSchema } from "@/lib/auth/validation";
import { useAuth } from "@/providers/auth";

/** For local accounts. Changing the password signs out every other browser and device. */
export function ChangePassword() {
  const { withToken } = useAuth();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", password: "", confirmPassword: "" },
  });
  const [changed, setChanged] = useState(false);

  const onSubmit = handleSubmit(async ({ currentPassword, password }) => {
    setChanged(false);
    try {
      await withToken((token) =>
        changeLocalPassword(token, { current_password: currentPassword, new_password: password }),
      );
      reset();
      setChanged(true);
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t change your password. Try again."),
      });
    }
  });

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      aria-labelledby="change-password-heading"
      className="space-y-3 border-t pt-4 @5xl/panel:border-t-0 @5xl/panel:pt-0"
    >
      <div className="space-y-1">
        <h3 id="change-password-heading" className="text-sm font-medium">
          Change password
        </h3>
        <p className="text-sm text-muted-foreground">
          Other browsers and devices signed in to this account will be signed out.
        </p>
      </div>
      <FormField
        label="Current password"
        type="password"
        autoComplete="current-password"
        {...register("currentPassword", { onChange: () => setChanged(false) })}
        error={errors.currentPassword?.message}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          label="New password"
          type="password"
          autoComplete="new-password"
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
      </div>
      <FormAlert message={errors.root?.server?.message ?? null} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="soft" disabled={isSubmitting}>
          {isSubmitting ? "Changing…" : "Change password"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {changed ? "Password changed. Other sessions were signed out." : null}
        </p>
      </div>
    </form>
  );
}
