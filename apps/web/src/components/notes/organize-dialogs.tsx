"use client";

import type { FolderDeleteMode, NoteFolder } from "@orbit/contracts";
import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { DialogShell } from "@/components/finance/dialog-shell";
import { FormAlert } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { buildFolderTree, flattenFolders, folderSubtree } from "@/lib/notes";
import { cn } from "@/utils/common";

const TOP = "top";

/** A folder picker's options, indented by depth, without `exclude` (and what's inside it). */
function folderOptions(
  folders: readonly NoteFolder[],
  { top, exclude }: { top: string; exclude?: string },
) {
  const hidden = exclude ? folderSubtree(folders, exclude) : new Set<string>();
  return [
    { value: TOP, label: top },
    ...flattenFolders(buildFolderTree(folders))
      .filter(({ folder }) => !hidden.has(folder.id))
      .map(({ folder, depth }) => ({
        value: folder.id,
        label: `${" ".repeat(depth)}${folder.name}`,
      })),
  ];
}

/** Ask for a name: a new folder, a folder's new name, or a tag's new name. */
export function NameDialog({
  title,
  label,
  initial = "",
  maxLength,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  maxLength: number;
  submitLabel: string;
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <DialogShell
      title={title}
      busy={busy}
      submitLabel={submitLabel}
      onClose={onClose}
      onSubmit={(event, close) => {
        event.preventDefault();
        const trimmed = name.replace(/\s+/g, " ").trim();
        if (!trimmed) {
          setError("Enter a name.");
          return;
        }
        setBusy(true);
        setError(null);
        onSubmit(trimmed).then(
          () => {
            setBusy(false);
            close();
          },
          (reason: unknown) => {
            setBusy(false);
            setError(describeApiError(reason, "Couldn’t save. Try again."));
          },
        );
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <Input
          id={id}
          autoFocus
          value={name}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <FormAlert message={error} />
    </DialogShell>
  );
}

/** Choose a folder: where to move a folder (`moving`) or a note. */
export function FolderPickerDialog({
  title,
  folders,
  current,
  moving,
  top,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  folders: readonly NoteFolder[];
  current: string | null;
  /** A folder being moved can't go inside itself. */
  moving?: string;
  top: string;
  submitLabel: string;
  onSubmit: (folderId: string | null) => Promise<unknown>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(current ?? TOP);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <DialogShell
      title={title}
      busy={busy}
      submitLabel={submitLabel}
      onClose={onClose}
      onSubmit={(event, close) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        onSubmit(value === TOP ? null : value).then(
          () => {
            setBusy(false);
            close();
          },
          (reason: unknown) => {
            setBusy(false);
            setError(describeApiError(reason, "Couldn’t move it. Try again."));
          },
        );
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          Destination
        </label>
        <Select
          id={id}
          value={value}
          onValueChange={setValue}
          options={folderOptions(folders, { top, exclude: moving })}
          className="w-full"
        />
      </div>
      <FormAlert message={error} />
    </DialogShell>
  );
}

const DELETE_CHOICES: readonly { value: FolderDeleteMode; label: string; description: string }[] = [
  {
    value: "parent",
    label: "Move its contents up a level",
    description: "Notes and subfolders move to the parent folder (or the top level).",
  },
  {
    value: "inbox",
    label: "Move its notes to the Inbox",
    description: "Subfolders are deleted too; every note inside goes to the Inbox.",
  },
  {
    value: "trash",
    label: "Move its notes to the Trash",
    description: "Subfolders are deleted too; notes can still be restored from the Trash.",
  },
];

/** Deleting a folder never deletes notes silently: the user chooses where they go. */
export function DeleteFolderDialog({
  folder,
  noteCount,
  onSubmit,
  onClose,
}: {
  folder: NoteFolder;
  /** Notes in the folder and its subfolders. */
  noteCount: number;
  onSubmit: (mode: FolderDeleteMode) => Promise<unknown>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<FolderDeleteMode>("parent");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = useId();
  return (
    <DialogShell
      title={`Delete “${folder.name}”?`}
      description={
        noteCount === 0
          ? "The folder is empty."
          : `It holds ${noteCount} ${noteCount === 1 ? "note" : "notes"}, counting subfolders.`
      }
      busy={busy}
      submitLabel="Delete folder"
      onClose={onClose}
      onSubmit={(event, close) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        onSubmit(mode).then(
          () => {
            setBusy(false);
            close();
          },
          (reason: unknown) => {
            setBusy(false);
            setError(describeApiError(reason, "Couldn’t delete the folder."));
          },
        );
      }}
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">What happens to what’s inside?</legend>
        {DELETE_CHOICES.map((choice) => (
          <label
            key={choice.value}
            className={cn(
              "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
              mode === choice.value ? "border-brand/50 bg-brand-subtle/50" : "hover:bg-accent/40",
            )}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={mode === choice.value}
              onChange={() => setMode(choice.value)}
              className="mt-0.5 accent-[var(--brand)]"
            />
            <span>
              <span className="block text-sm font-medium">{choice.label}</span>
              <span className="block text-xs text-muted-foreground">{choice.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <FormAlert message={error} />
    </DialogShell>
  );
}
