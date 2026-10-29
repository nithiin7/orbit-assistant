"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { updateMe } from "@/api/profile";
import { FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { displayNameSchema } from "@/lib/auth/validation";
import { useAuth, useCurrentUser } from "@/providers/auth";

import { ProfilePhoto } from "./profile-photo";

const providerLabels = {
  local: "Local account, stored in this installation’s database",
  supabase: "Supabase account (Orbit cloud)",
} as const;

export function AccountSettings() {
  const { withToken, setUser, signOut } = useAuth();
  const user = useCurrentUser();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(displayNameSchema),
    defaultValues: { displayName: user.display_name },
  });
  const [saved, setSaved] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const unchanged = useWatch({ control, name: "displayName" }).trim() === user.display_name;

  const onSubmit = handleSubmit(async ({ displayName }) => {
    setSaved(false);
    try {
      const updated = await withToken((token) => updateMe(token, { display_name: displayName }));
      setUser(updated);
      reset({ displayName: updated.display_name });
      setSaved(true);
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save your name. Try again."),
      });
    }
  });

  return (
    <div className="space-y-6">
      <ProfilePhoto />

      <dl className="grid gap-4 rounded-xl border bg-card p-4 text-sm sm:grid-cols-2">
        <div className="min-w-0 space-y-0.5">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="truncate font-medium">{user.email}</dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">Sign-in method</dt>
          <dd className="font-medium">{providerLabels[user.auth_provider]}</dd>
        </div>
      </dl>

      <form noValidate onSubmit={onSubmit} className="space-y-3">
        <FormField
          label="Display name"
          autoComplete="name"
          {...register("displayName", { onChange: () => setSaved(false) })}
          error={errors.displayName?.message}
        />
        <FormAlert message={errors.root?.server?.message ?? null} />
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={isSubmitting || unchanged}>
            {isSubmitting ? "Saving…" : "Save name"}
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {saved ? "Saved." : null}
          </p>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-sm text-muted-foreground">
          Signing out removes your session from this browser.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void signOut();
          }}
        >
          <LogOut aria-hidden="true" />
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </div>
  );
}
