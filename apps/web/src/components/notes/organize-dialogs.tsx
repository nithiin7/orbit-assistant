"use client";

import type { FolderDeleteMode, NoteFolder } from "@orbit/contracts";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { DialogShell } from "@/components/dialog-shell";
import { FolderDeleteChoices } from "@/components/folders/folder-dialogs";
import { FormAlert } from "@/components/form-field";

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
      <FolderDeleteChoices choices={DELETE_CHOICES} value={mode} onChange={setMode} />
      <FormAlert message={error} />
    </DialogShell>
  );
}
