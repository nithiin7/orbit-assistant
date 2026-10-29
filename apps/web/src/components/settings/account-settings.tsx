"use client";

import { LogOut } from "lucide-react";
import { type FormEvent, useState } from "react";

import { describeApiError } from "@/api/client";
import { updateMe } from "@/api/profile";
import { useAuth, useCurrentUser } from "@/components/auth/auth-provider";
import { FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { validateName } from "@/lib/auth/validation";

import { ProfilePhoto } from "./profile-photo";

const providerLabels = {
  local: "Local account, stored in this installation’s database",
  supabase: "Supabase account (Orbit cloud)",
} as const;

export function AccountSettings() {
  const { withToken, setUser, signOut } = useAuth();
  const user = useCurrentUser();
  const [displayName, setDisplayName] = useState(user.display_name);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const unchanged = displayName.trim() === user.display_name;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateName(displayName, "your name");
    setFieldError(error);
    setFormError(null);
    setSaved(false);
    if (error) return;
    setSaving(true);
    try {
      const updated = await withToken((token) =>
        updateMe(token, { display_name: displayName.trim() }),
      );
      setUser(updated);
      setDisplayName(updated.display_name);
      setSaved(true);
    } catch (reason) {
      setFormError(describeApiError(reason, "Couldn’t save your name. Try again."));
    }
    setSaving(false);
  }

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
          name="name"
          autoComplete="name"
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
            setSaved(false);
          }}
          error={fieldError}
        />
        <FormAlert message={formError} />
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={saving || unchanged}>
            {saving ? "Saving…" : "Save name"}
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
