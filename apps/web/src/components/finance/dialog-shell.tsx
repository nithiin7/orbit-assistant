"use client";

import { X } from "lucide-react";
import { type FormEvent, type ReactNode, useId } from "react";

import { Button } from "@/components/ui/button";
import { useModalDialog } from "@/hooks/use-modal-dialog";

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
 * The modal form frame the commitment dialogs share: a heading, a close button, the fields, and
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
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className={`dialog-motion dialog-pop mx-auto mt-[6vh] max-h-[88vh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3 ${wide ? "max-w-2xl" : "max-w-lg"}`}
    >
      <form noValidate onSubmit={(event) => onSubmit(event, close)} className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 id={`${id}-heading`} className="text-base font-semibold">
              {title}
            </h2>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
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
        {children}
        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : submitLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
