import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/utils/common";

/**
 * The frame of a centered modal: spread `useModalDialog`'s `dialogProps` onto it, and pass the
 * dialog's own placement and size (`mt-[10vh] max-w-sm`, `max-h-[88vh] overflow-y-auto`, …) as
 * `className`.
 */
function Dialog({ className, ...props }: ComponentProps<"dialog">) {
  return (
    <dialog
      className={cn(
        "dialog-motion dialog-pop mx-auto w-[calc(100%-2rem)] rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3",
        className,
      )}
      {...props}
    />
  );
}

/** The ghost "Close" icon button in a dialog's top-right corner. */
function DialogCloseButton({ className, onClick }: { className?: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("-mt-1.5 -mr-1.5 size-8", className)}
      aria-label="Close"
      onClick={onClick}
    >
      <X aria-hidden="true" />
    </Button>
  );
}

type DialogHeaderProps = {
  /** The heading's id, for the dialog's `aria-labelledby`. */
  titleId: string;
  title: ReactNode;
  /** Extra heading classes, e.g. to sit an icon beside the title. */
  titleClassName?: string;
  /**
   * Shown under the title (pass the element, styled as the dialog needs). When given, even as
   * `null`, the title and description share a `space-y-1` block.
   */
  description?: ReactNode;
  onClose: () => void;
};

/** A dialog's heading, optional description, and close button. */
function DialogHeader({ titleId, title, titleClassName, description, onClose }: DialogHeaderProps) {
  const heading = (
    <h2 id={titleId} className={cn("text-base font-semibold", titleClassName)}>
      {title}
    </h2>
  );
  return (
    <div className="flex items-start justify-between gap-4">
      {description === undefined ? (
        heading
      ) : (
        <div className="space-y-1">
          {heading}
          {description}
        </div>
      )}
      <DialogCloseButton onClick={onClose} />
    </div>
  );
}

/** A dialog's bottom row of actions, stacked on narrow screens. */
function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
      {children}
    </div>
  );
}

type DialogFormActionsProps = {
  /** While true, both buttons are disabled and the submit button shows `busyLabel`. */
  busy: boolean;
  onCancel: () => void;
  submitLabel: ReactNode;
  busyLabel?: ReactNode;
  /** Disables submit for other reasons too; defaults to `busy`. */
  submitDisabled?: boolean;
};

/** A form dialog's Cancel and submit buttons. */
function DialogFormActions({
  busy,
  onCancel,
  submitLabel,
  busyLabel = "Saving…",
  submitDisabled = busy,
}: DialogFormActionsProps) {
  return (
    <DialogFooter>
      <Button variant="ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={submitDisabled}>
        {busy ? busyLabel : submitLabel}
      </Button>
    </DialogFooter>
  );
}

export { Dialog, DialogCloseButton, DialogFooter, DialogFormActions, DialogHeader };
