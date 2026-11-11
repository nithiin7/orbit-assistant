"use client";

import { type FormEvent, type ReactNode, useId } from "react";

import { Dialog, DialogFormActions, DialogHeader } from "@/components/ui/dialog";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/utils/common";

type DialogShellProps = {
  title: string;
  description?: string;
  /** Keep it open while a save is in flight. */
  busy: boolean;
  onClose: () => void;
  /** Gets `close`, to call once saved. */
  onSubmit: (event: FormEvent<HTMLFormElement>, close: () => void) => void;
  submitLabel: string;
  children: ReactNode;
  /** Wider dialogs for forms with two columns of fields. */
  wide?: boolean;
};

/**
 * The modal form frame most module dialogs share: a heading, a close button, the fields, and
 * Cancel and submit buttons, in a native `<dialog>` that traps focus and restores it on close.
 */
export function DialogShell({
  title,
  description,
  busy,
  onClose,
  onSubmit,
  submitLabel,
  children,
  wide = false,
}: DialogShellProps) {
  const id = useId();
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !busy });
  return (
    <Dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className={cn("mt-[6vh] max-h-[88vh] overflow-y-auto", wide ? "max-w-2xl" : "max-w-lg")}
    >
      <form noValidate onSubmit={(event) => onSubmit(event, close)} className="space-y-4 p-5">
        <DialogHeader
          titleId={`${id}-heading`}
          title={title}
          description={
            description ? <p className="text-xs text-muted-foreground">{description}</p> : null
          }
          onClose={close}
        />
        {children}
        <DialogFormActions busy={busy} onCancel={close} submitLabel={submitLabel} />
      </form>
    </Dialog>
  );
}
