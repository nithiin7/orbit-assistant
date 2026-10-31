"use client";

import { type ReactNode, useCallback, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useModalDialog } from "@/hooks/use-modal-dialog";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel: string;
  /** Styles the confirm button as destructive, for actions that delete or can't be undone. */
  destructive?: boolean;
};

type ConfirmDialogProps = ConfirmOptions & {
  /** Called once the dialog has closed, with whether the action was confirmed. */
  onClose: (confirmed: boolean) => void;
};

/** Asks the user to confirm an action, in a modal `<dialog>`. Focus starts on Cancel. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive = false,
  onClose,
}: ConfirmDialogProps) {
  const id = useId();
  const confirmedRef = useRef(false);
  const { close, dialogProps } = useModalDialog({
    onClose: () => onClose(confirmedRef.current),
  });

  return (
    <dialog
      {...dialogProps}
      role="alertdialog"
      aria-labelledby={`${id}-heading`}
      aria-describedby={description ? `${id}-description` : undefined}
      className="dialog-motion dialog-pop mx-auto mt-[10vh] w-[calc(100%-2rem)] max-w-sm rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <div className="space-y-4 p-5">
        <div className="space-y-1.5">
          <h2 id={`${id}-heading`} className="text-base font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={`${id}-description`} className="text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" autoFocus onClick={close}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              confirmedRef.current = true;
              close();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

type PendingConfirm = ConfirmOptions & { resolve: (confirmed: boolean) => void };

/**
 * An awaitable replacement for `window.confirm`: `await confirm({ … })` opens a
 * `ConfirmDialog` and resolves with whether the user confirmed. Render `confirmDialog`
 * somewhere in the calling component.
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmDialog: ReactNode;
} {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  const confirmDialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      description={pending.description}
      confirmLabel={pending.confirmLabel}
      destructive={pending.destructive}
      onClose={(confirmed) => {
        setPending(null);
        pending.resolve(confirmed);
      }}
    />
  ) : null;

  return { confirm, confirmDialog };
}
