"use client";

import { useId, useState } from "react";

import { FormField } from "@/components/form-field";
import { Dialog, DialogFormActions, DialogHeader } from "@/components/ui/dialog";
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
    <Dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      aria-describedby={`${id}-description`}
      className="mt-[10vh] max-w-sm"
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
        <DialogHeader titleId={`${id}-heading`} title={title} onClose={close} />
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
        <DialogFormActions
          busy={busy}
          onCancel={close}
          submitLabel={submitLabel}
          busyLabel="Working…"
          submitDisabled={busy || (empty && !optional)}
        />
      </form>
    </Dialog>
  );
}
