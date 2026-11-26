"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { Globe2, LogOut, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { updateMe } from "@/api/profile";
import { FormAlert, FormField } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { displayNameSchema } from "@/lib/auth/validation";
import { settingsSectionsClassName } from "@/lib/settings";
import { SETUP_PATH } from "@/lib/setup";
import { useAuth, useCurrentUser } from "@/providers/auth";

import { ChangePassword } from "./change-password";
import { ProfilePhoto } from "./profile-photo";
import { SettingsCard } from "./settings-card";
import { TimeZonePreference } from "./time-zone-preference";

const providerLabels = {
  local: "Local account",
  supabase: "Orbit cloud",
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
    <div className={settingsSectionsClassName}>
      <SettingsCard
        titleId="account-profile-title"
        icon={UserRound}
        title="Profile"
        description="Your photo and the name Orbit greets you by."
      >
        <ProfilePhoto />
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="min-w-0 space-y-0.5 rounded-xl bg-muted/40 px-3.5 py-3">
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="truncate font-medium">{user.email}</dd>
          </div>
          <div className="space-y-0.5 rounded-xl bg-muted/40 px-3.5 py-3">
            <dt className="text-xs text-muted-foreground">Sign-in method</dt>
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
      </SettingsCard>

      <SettingsCard
        titleId="account-time-zone-title"
        icon={Globe2}
        title="Local time"
        description="Where your day starts and ends."
      >
        <TimeZonePreference />
      </SettingsCard>

      {user.auth_provider === "local" ? <ChangePassword /> : null}

      <SettingsCard
        titleId="setup-guide-title"
        icon={Sparkles}
        title="Setup guide"
        description="Walk through theme, money, health, accounts, and AI again."
        action={
          <Link href={SETUP_PATH} className={buttonVariants({ variant: "soft", size: "sm" })}>
            <Sparkles aria-hidden="true" />
            Run setup again
          </Link>
        }
      />

      <SettingsCard
        titleId="account-sign-out-title"
        icon={LogOut}
        tone="slate"
        title="Sign out"
        description="Leave Orbit in this browser. Your data stays where it is."
        action={
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
        }
      />
    </div>
  );
}
