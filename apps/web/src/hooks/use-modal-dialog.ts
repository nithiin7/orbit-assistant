"use client";

import { type MouseEvent, type RefObject, useCallback, useEffect, useRef } from "react";

type ModalDialog = {
  /** Closes the dialog; `onClose` runs once it has. */
  close: () => void;
  /** Spread onto the `<dialog>` element. */
  dialogProps: {
    ref: RefObject<HTMLDialogElement | null>;
    onClose: () => void;
    onClick: (event: MouseEvent<HTMLDialogElement>) => void;
  };
};

/**
 * A native modal `<dialog>` that opens when it mounts. The browser provides focus containment,
 * Escape to close, and an inert background; this adds closing on a backdrop click (while
 * `dismissible`) and returning focus to whatever was focused before it opened.
 */
export function useModalDialog({
  onClose,
  dismissible = true,
}: {
  /** Called once the dialog has closed, by any means. */
  onClose: () => void;
  dismissible?: boolean;
}): ModalDialog {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
  }, []);

  const close = useCallback(() => ref.current?.close(), []);

  return {
    close,
    dialogProps: {
      ref,
      onClose: () => {
        returnFocusRef.current?.focus();
        onClose();
      },
      onClick: (event) => {
        // A click on the dialog element itself (not its content) is a backdrop click.
        if (event.target === event.currentTarget && dismissible) close();
      },
    },
  };
}
