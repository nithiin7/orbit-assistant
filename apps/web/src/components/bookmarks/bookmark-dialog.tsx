"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { BookmarkCollection } from "@orbit/contracts";
import Link from "next/link";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogFormActions, DialogHeader } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  AUTO,
  bookmarkSchema,
  type BookmarkValues,
  KIND_LABELS,
  KINDS,
  NO_COLLECTION,
  NOTE_MAX_LENGTH,
  STATUS_LABELS,
  STATUSES,
} from "@/lib/bookmarks";
import { cn } from "@/utils/common";

type BookmarkDialogProps = {
  mode: "add" | "edit";
  initial: BookmarkValues;
  collections: readonly BookmarkCollection[];
  /** Whether the workspace fetches link previews, which changes what "Save a link" promises. */
  previewsOn?: boolean;
  onSave: (values: BookmarkValues) => Promise<void>;
  /** Called once the dialog has closed, whether saved or cancelled. */
  onClose: () => void;
};

/** Saves a new link or edits one, in a modal `<dialog>`. */
export function BookmarkDialog({
  mode,
  initial,
  collections,
  previewsOn = false,
  onSave,
  onClose,
}: BookmarkDialogProps) {
  const id = useId();
  const adding = mode === "add";
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm({ resolver: yupResolver(bookmarkSchema), defaultValues: initial });
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });
  const note = useWatch({ control, name: "note" });

  async function save(values: BookmarkValues) {
    try {
      await onSave(values);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the link. Try again."),
      });
    }
  }

  const auto = adding ? [{ value: AUTO, label: "Work it out from the link" }] : [];
  const kindOptions = [
    ...auto,
    ...KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
  ];
  const statusOptions = [
    ...auto,
    ...STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
  ];
  const collectionOptions = [
    { value: NO_COLLECTION, label: "No collection" },
    ...collections.map((entry) => ({ value: entry.id, label: entry.name })),
  ];

  return (
    <Dialog {...dialogProps} aria-labelledby={`${id}-heading`} className="mt-[8vh] max-w-lg">
      <form
        noValidate
        // Called here, not during render: `save` closes the dialog through a ref.
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <DialogHeader
          titleId={`${id}-heading`}
          title={adding ? "Save a link" : "Edit link"}
          description={
            adding ? (
              <p className="text-sm text-pretty text-muted-foreground">
                {previewsOn ? (
                  "Only the link is needed. Orbit fetches the page’s name, description, and image after you save."
                ) : (
                  <>
                    Only the link is needed; the rest is optional.{" "}
                    <Link
                      href="/settings/saved"
                      className="rounded-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Turn on link previews
                    </Link>{" "}
                    to fill in names and images automatically.
                  </>
                )}
              </p>
            ) : null
          }
          onClose={close}
        />

        <FormField
          label="Link"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoFocus={adding}
          placeholder="https://"
          {...register("url")}
          error={errors.url?.message}
        />
        <FormField
          label="Name"
          autoComplete="off"
          autoFocus={!adding}
          placeholder={adding ? "Leave blank to name it after the site" : undefined}
          {...register("title")}
          error={errors.title?.message}
        />
        <div className="space-y-1.5">
          <label htmlFor={`${id}-note`} className="block text-sm font-medium">
            What it’s for <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={`${id}-note`}
            rows={2}
            placeholder="Prod dashboards for on-call, a recipe to try, a workout to copy…"
            {...register("note")}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={`${id}-note-hint`}
          />
          <p
            id={`${id}-note-hint`}
            className={cn(
              "text-xs",
              errors.note ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            {errors.note?.message ?? `${note.trim().length} / ${NOTE_MAX_LENGTH} characters`}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField control={control} name="kind" label="Type" options={kindOptions} />
          <SelectField control={control} name="status" label="Status" options={statusOptions} />
          <SelectField
            control={control}
            name="collectionId"
            label="Collection"
            options={collectionOptions}
          />
          <FormField
            label="Tags"
            hint="Separate with commas."
            autoComplete="off"
            placeholder="recipes, weekend"
            {...register("tags")}
            error={errors.tags?.message}
          />
        </div>

        <label className="flex items-center gap-2.5 text-sm">
          <Checkbox {...register("pinned")} />
          <span>
            Pin it
            <span className="text-muted-foreground"> — keep it in the quick-launch row</span>
          </span>
        </label>

        <FormAlert message={errors.root?.server?.message ?? null} />

        <DialogFormActions
          busy={saving}
          onCancel={close}
          submitLabel={adding ? "Save link" : "Save changes"}
        />
      </form>
    </Dialog>
  );
}
