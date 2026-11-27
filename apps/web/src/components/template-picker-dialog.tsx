"use client";

import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";
import { useId, useState } from "react";

import { FormAlert } from "@/components/form-field";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { IconChip } from "@/components/ui/icon-chip";
import { useModalDialog } from "@/hooks/use-modal-dialog";

/** A starter shown in the picker: what it is, and the first few things it adds. */
export type PickerTemplate = {
  id: string;
  name: string;
  blurb: string;
  icon: LucideIcon;
  /** Lines previewed on the card, such as the tasks or items it adds. */
  preview: readonly string[];
  /** The card's call to action, such as "Add 6 tasks". */
  actionLabel: string;
};

const PREVIEW_LINES = 4;

/**
 * Ready-made starters for a module's empty view. Choosing one runs `onUse`; the dialog stays open
 * with an error if that fails, and closes once it succeeds.
 */
export function TemplatePickerDialog<T extends PickerTemplate>({
  title,
  description,
  templates,
  onUse,
  errorMessage,
  onClose,
}: {
  title: string;
  description: string;
  templates: readonly T[];
  onUse: (template: T) => Promise<void>;
  /** Shown when `onUse` fails. */
  errorMessage: string;
  onClose: () => void;
}) {
  const id = useId();
  const { close, dialogProps } = useModalDialog({ onClose });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const use = async (template: T) => {
    setBusyId(template.id);
    setError(null);
    try {
      await onUse(template);
      close();
    } catch {
      setError(errorMessage);
      setBusyId(null);
    }
  };

  return (
    <Dialog
      {...dialogProps}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      className="mt-[8vh] max-h-[84vh] max-w-2xl overflow-y-auto"
    >
      <div className="space-y-4 p-5">
        <DialogHeader
          titleId={`${id}-title`}
          title={title}
          description={
            <p id={`${id}-description`} className="text-sm text-muted-foreground">
              {description}
            </p>
          }
          onClose={close}
        />
        <FormAlert message={error} />
        <ul className="grid gap-3 sm:grid-cols-2">
          {templates.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                disabled={busyId !== null}
                aria-busy={busyId === template.id || undefined}
                onClick={() => void use(template)}
                aria-label={`${template.actionLabel} from “${template.name}”`}
                className="flex h-full w-full flex-col gap-3 rounded-2xl border bg-card p-4 text-left transition-[border-color,translate,box-shadow,opacity] duration-150 outline-none hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-elevation-2 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:hover:translate-y-0"
              >
                <span className="flex items-start gap-3">
                  <IconChip icon={template.icon} tone="brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{template.name}</span>
                    <span className="block text-xs text-pretty text-muted-foreground">
                      {template.blurb}
                    </span>
                  </span>
                </span>
                <span className="space-y-1 text-xs text-muted-foreground">
                  {template.preview.slice(0, PREVIEW_LINES).map((line) => (
                    <span key={line} className="flex items-center gap-2">
                      <span className="size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                      <span className="truncate">{line}</span>
                    </span>
                  ))}
                  {template.preview.length > PREVIEW_LINES ? (
                    <span className="block pl-3">
                      and {template.preview.length - PREVIEW_LINES} more
                    </span>
                  ) : null}
                </span>
                <span className="mt-auto flex items-center gap-1 pt-1 text-xs font-medium text-brand">
                  <Plus className="size-3.5" aria-hidden="true" />
                  {busyId === template.id ? "Adding…" : template.actionLabel}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
