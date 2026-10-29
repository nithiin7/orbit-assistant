"use client";

import { Camera, Trash2 } from "lucide-react";
import { type ChangeEvent, useState } from "react";

import { describeApiError } from "@/api/client";
import { UserAvatar } from "@/components/avatar/user-avatar";
import { FormAlert } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { AvatarImageError } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { useAvatar } from "@/providers/avatar-provider";

type Busy = "uploading" | "removing" | null;

export function ProfilePhoto() {
  const { url, loading, upload, remove } = useAvatar();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onChoose(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Clear the input so choosing the same file again still fires a change.
    input.value = "";
    if (!file) return;
    setError(null);
    setMessage(null);
    setBusy("uploading");
    try {
      await upload(file);
      setMessage("Photo updated.");
    } catch (reason) {
      setError(
        reason instanceof AvatarImageError
          ? reason.message
          : describeApiError(reason, "Couldn’t upload your photo. Try again."),
      );
    }
    setBusy(null);
  }

  async function onRemove() {
    setError(null);
    setMessage(null);
    setBusy("removing");
    try {
      await remove();
      setMessage("Photo removed.");
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t remove your photo. Try again."));
    }
    setBusy(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <UserAvatar size="lg" />
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* A styled label keeps the native file picker keyboard- and screen-reader-friendly. */}
            <label
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background has-disabled:pointer-events-none has-disabled:opacity-50",
              )}
            >
              <Camera aria-hidden="true" />
              {busy === "uploading" ? "Uploading…" : url ? "Change photo" : "Upload photo"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={busy !== null || loading}
                onChange={(event) => void onChoose(event)}
              />
            </label>
            {url ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => void onRemove()}
              >
                <Trash2 aria-hidden="true" />
                {busy === "removing" ? "Removing…" : "Remove"}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Cropped to a square and resized before upload. Stored in Orbit’s database.
          </p>
        </div>
      </div>
      <FormAlert message={error} />
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
