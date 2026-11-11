"use client";

import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { DialogShell } from "@/components/dialog-shell";
import { FormAlert } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/utils/common";
import { buildFolderTree, flattenFolders, type FolderLike, folderSubtree } from "@/utils/folders";

const TOP = "top";

/** A folder picker's options, indented by depth, without `exclude` (and what's inside it). */
function folderOptions(
  folders: readonly FolderLike[],
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
  folders: readonly FolderLike[];
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

/**
 * The radio cards a delete-folder dialog uses to ask what happens to the folder's contents.
 * Each module passes its own choices.
 */
export function FolderDeleteChoices<Mode extends string>({
  choices,
  value,
  onChange,
}: {
  choices: readonly { value: Mode; label: string; description: string }[];
  value: Mode;
  onChange: (mode: Mode) => void;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">What happens to what’s inside?</legend>
      {choices.map((choice) => (
        <label
          key={choice.value}
          className={cn(
            "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
            value === choice.value ? "border-brand/50 bg-brand-subtle/50" : "hover:bg-accent/40",
          )}
        >
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
            className="mt-0.5 accent-[var(--brand)]"
          />
          <span>
            <span className="block text-sm font-medium">{choice.label}</span>
            <span className="block text-xs text-muted-foreground">{choice.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
