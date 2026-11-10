"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { BookmarkCollection } from "@orbit/contracts";
import { X } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[8vh] w-[calc(100%-2rem)] max-w-lg rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <form
        noValidate
        // Called here, not during render: `save` closes the dialog through a ref.
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 id={`${id}-heading`} className="text-base font-semibold">
              {adding ? "Save a link" : "Edit link"}
            </h2>
            {adding ? (
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
            ) : null}
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

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : adding ? "Save link" : "Save changes"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
