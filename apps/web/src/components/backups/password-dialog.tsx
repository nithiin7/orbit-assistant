"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { useModalDialog } from "@/hooks/use-modal-dialog";

type PasswordDialogProps = {
  title: string;
  description: string;
  submitLabel: string;
  /** Allow submitting without a password. */
  optional?: boolean;
  onSubmit: (password: string | null) => Promise<void>;
  onClose: () => void;
};

/** Asks for an existing backup's password. It's sent once and never kept. */
export function PasswordDialog({
  title,
  description,
  submitLabel,
  optional = false,
  onSubmit,
  onClose,
}: PasswordDialogProps) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !busy });
  const empty = password.length === 0;

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      aria-describedby={`${id}-description`}
      className="dialog-motion dialog-pop mx-auto mt-[10vh] w-[calc(100%-2rem)] max-w-sm rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <form
        noValidate
        className="space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (empty && !optional) return;
          setBusy(true);
          void onSubmit(empty ? null : password).finally(() => {
            setBusy(false);
            close();
          });
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-heading`} className="text-base font-semibold">
            {title}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="-mt-1.5 -mr-1.5 size-8"
            aria-label="Close"
            onClick={close}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <p id={`${id}-description`} className="text-sm text-muted-foreground">
          {description}
        </p>
        <FormField
          label="Backup password"
          type="password"
          autoComplete="off"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || (empty && !optional)}>
            {busy ? "Working…" : submitLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
