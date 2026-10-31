"use client";

import type { Note, NoteFolder, NoteRef, Tag } from "@orbit/contracts";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckSquare,
  Download,
  FileText,
  Hash,
  Paperclip,
  Plus,
  X,
} from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAttachmentDownload,
  useAttachments,
  useNoteLinks,
  useNoteMutations,
  useNoteTasks,
} from "@/hooks/use-notes";
import {
  buildFolderTree,
  flattenFolders,
  folderPath,
  normalizeTagName,
  noteDisplayTitle,
} from "@/lib/notes";
import { cn } from "@/utils/common";

import { TaskPickerDialog } from "./pickers";

const INBOX = "inbox";

type NoteDetailsProps = {
  workspaceId: string;
  note: Note;
  folders: readonly NoteFolder[];
  tags: readonly Tag[];
  readOnly: boolean;
  onOpenNote: (noteId: string) => void;
};

/** The note's folder, tags, connections, tasks, and files. */
export function NoteDetails({
  workspaceId,
  note,
  folders,
  tags,
  readOnly,
  onOpenNote,
}: NoteDetailsProps) {
  const mutations = useNoteMutations(workspaceId);
  const [error, setError] = useState<string | null>(null);
  const folderOptions = [
    { value: INBOX, label: "Inbox (no folder)" },
    ...flattenFolders(buildFolderTree(folders)).map(({ folder }) => ({
      value: folder.id,
      label: folderPath(folders, folder.id).join(" / "),
    })),
  ];

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(describeApiError(reason, fallback));
    }
  };

  return (
    <div className="space-y-6 text-sm">
      <FormAlert message={error} />
      {note.note_type === "journal" ? null : (
        <Section title="Folder">
          <Select
            aria-label="Folder"
            value={note.folder_id ?? INBOX}
            options={folderOptions}
            disabled={readOnly}
            className="w-full"
            onValueChange={(value) =>
              void run(
                () =>
                  mutations.update.mutateAsync({
                    noteId: note.id,
                    changes: { folder_id: value === INBOX ? null : value },
                  }),
                "Couldn’t move the note.",
              )
            }
          />
        </Section>
      )}

      <Section title="Tags">
        <TagEditor
          note={note}
          tags={tags}
          readOnly={readOnly}
          onAdd={(name) =>
            run(
              () => mutations.addTag.mutateAsync({ noteId: note.id, name }),
              "Couldn’t add the tag.",
            )
          }
          onRemove={(tagId) =>
            run(
              () => mutations.removeTag.mutateAsync({ noteId: note.id, tagId }),
              "Couldn’t remove the tag.",
            )
          }
        />
      </Section>

      <Connections workspaceId={workspaceId} noteId={note.id} onOpenNote={onOpenNote} />

      <LinkedTasks workspaceId={workspaceId} note={note} readOnly={readOnly} onError={setError} />

      <Attachments workspaceId={workspaceId} noteId={note.id} readOnly={readOnly} />
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={id} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function TagEditor({
  note,
  tags,
  readOnly,
  onAdd,
  onRemove,
}: {
  note: Note;
  tags: readonly Tag[];
  readOnly: boolean;
  onAdd: (name: string) => Promise<void>;
  onRemove: (tagId: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const typed = normalizeTagName(value);
  const assigned = new Set(note.tags.map((tag) => normalizeTagName(tag.name)));
  const suggestions = typed
    ? tags
        .filter((tag) => {
          const name = normalizeTagName(tag.name);
          return name.includes(typed) && !assigned.has(name);
        })
        .slice(0, 6)
    : [];

  const add = async (name: string) => {
    if (!normalizeTagName(name)) return;
    setValue("");
    setActive(-1);
    await onAdd(name);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      setActive((active + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      setActive((active - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      void add(suggestions[active]?.name ?? value);
    } else if (event.key === "Escape" && value) {
      event.preventDefault();
      setValue("");
    }
  };

  return (
    <div className="space-y-2">
      {note.tags.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags on this note">
          {note.tags.map((tag) => (
            <li
              key={tag.id}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-muted pr-1 pl-2.5 text-xs font-medium"
            >
              <Hash className="size-3 text-muted-foreground" aria-hidden="true" />
              {tag.name}
              {readOnly ? null : (
                <button
                  type="button"
                  aria-label={`Remove tag “${tag.name}”`}
                  onClick={() => void onRemove(tag.id)}
                  className="flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : readOnly ? (
        <p className="text-muted-foreground">No tags.</p>
      ) : null}
      {readOnly ? null : (
        <div className="relative">
          <input
            ref={inputRef}
            value={value}
            maxLength={50}
            role="combobox"
            aria-label="Add a tag"
            aria-expanded={suggestions.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            placeholder="Add a tag…"
            onChange={(event) => {
              setValue(event.target.value);
              setActive(-1);
            }}
            onKeyDown={onKeyDown}
            className="h-8 w-full rounded-md border border-input bg-card px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-transparent"
          />
          <ul
            id={listId}
            role="listbox"
            aria-label="Matching tags"
            className={cn(
              "absolute inset-x-0 top-full z-20 mt-1 rounded-md border bg-popover p-1 shadow-elevation-2",
              suggestions.length === 0 && "hidden",
            )}
          >
            {suggestions.map((tag, index) => (
              <li
                key={tag.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void add(tag.name)}
                className={cn(
                  "flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm",
                  index === active && "bg-accent",
                )}
              >
                {tag.name}
                <span className="text-xs text-muted-foreground tabular-nums">{tag.note_count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NoteRefList({
  refs,
  empty,
  icon: Icon,
  onOpenNote,
}: {
  refs: readonly NoteRef[];
  empty: string;
  icon: typeof ArrowUpRight;
  onOpenNote: (noteId: string) => void;
}) {
  if (refs.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-0.5">
      {refs.map((ref) => (
        <li key={ref.id}>
          <button
            type="button"
            onClick={() => onOpenNote(ref.id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{noteDisplayTitle(ref)}</span>
            {ref.archived ? <span className="text-xs text-muted-foreground">Archived</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Connections({
  workspaceId,
  noteId,
  onOpenNote,
}: {
  workspaceId: string;
  noteId: string;
  onOpenNote: (noteId: string) => void;
}) {
  const links = useNoteLinks(workspaceId, noteId);
  if (links.status === "loading") {
    return (
      <Section title="Links">
        <Skeleton className="h-8 w-full" />
      </Section>
    );
  }
  if (links.status === "error") {
    return (
      <Section title="Links">
        <p className="text-destructive">{links.message}</p>
      </Section>
    );
  }
  return (
    <>
      <Section
        title={`Backlinks${links.data.backlinks.length ? ` · ${links.data.backlinks.length}` : ""}`}
      >
        <NoteRefList
          refs={links.data.backlinks}
          empty="No notes link here yet."
          icon={ArrowDownLeft}
          onOpenNote={onOpenNote}
        />
      </Section>
      <Section title="Links to">
        <NoteRefList
          refs={links.data.outgoing}
          empty="Link a note from the toolbar to connect it."
          icon={ArrowUpRight}
          onOpenNote={onOpenNote}
        />
      </Section>
    </>
  );
}

function LinkedTasks({
  workspaceId,
  note,
  readOnly,
  onError,
}: {
  workspaceId: string;
  note: Note;
  readOnly: boolean;
  onError: (message: string | null) => void;
}) {
  const tasks = useNoteTasks(workspaceId, note.id);
  const mutations = useNoteMutations(workspaceId);
  const [picking, setPicking] = useState(false);

  const link = async (taskId: string) => {
    onError(null);
    try {
      await mutations.linkTask.mutateAsync({ noteId: note.id, taskId });
    } catch (reason) {
      onError(describeApiError(reason, "Couldn’t link the task."));
    }
  };
  const unlink = async (taskId: string) => {
    onError(null);
    try {
      await mutations.unlinkTask.mutateAsync({ noteId: note.id, taskId });
    } catch (reason) {
      onError(describeApiError(reason, "Couldn’t unlink the task."));
    }
  };

  return (
    <Section
      title="Tasks"
      action={
        readOnly ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setPicking(true)}
          >
            <Plus aria-hidden="true" />
            Link task
          </Button>
        )
      }
    >
      {tasks.status === "loading" ? (
        <Skeleton className="h-8 w-full" />
      ) : tasks.status === "error" ? (
        <p className="text-destructive">{tasks.message}</p>
      ) : tasks.data.tasks.length === 0 ? (
        <p className="text-muted-foreground">No linked tasks.</p>
      ) : (
        <ul className="space-y-0.5">
          {tasks.data.tasks.map((task) => (
            <li
              key={task.id}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60"
            >
              <CheckSquare
                className={cn(
                  "size-3.5 shrink-0",
                  task.status === "completed" ? "text-brand" : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
              <Link
                href={`/tasks?task=${task.id}`}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-sm outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring",
                  task.status === "completed" && "text-muted-foreground line-through",
                )}
              >
                {task.title}
                <span className="sr-only">{task.status === "completed" ? " (completed)" : ""}</span>
              </Link>
              {readOnly ? null : (
                <button
                  type="button"
                  aria-label={`Unlink “${task.title}”`}
                  onClick={() => void unlink(task.id)}
                  className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-60 outline-none group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {picking ? (
        <TaskPickerDialog
          workspaceId={workspaceId}
          excludeIds={note.task_ids}
          onClose={() => setPicking(false)}
          onPick={(task) => void link(task.id)}
        />
      ) : null}
    </Section>
  );
}

const ACCEPTED =
  ".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.csv,.json,.zip,.docx,.xlsx,.pptx,.odt,.ods";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Attachments({
  workspaceId,
  noteId,
  readOnly,
}: {
  workspaceId: string;
  noteId: string;
  readOnly: boolean;
}) {
  const fetchFile = useAttachmentDownload(workspaceId);
  const attachments = useAttachments(workspaceId, noteId);
  const mutations = useNoteMutations(workspaceId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const maxBytes = attachments.status === "success" ? attachments.data.max_bytes : null;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    for (const file of files) {
      if (maxBytes !== null && file.size > maxBytes) {
        setError(`“${file.name}” is larger than ${formatBytes(maxBytes)}.`);
        continue;
      }
      try {
        await mutations.upload.mutateAsync({ noteId, file });
      } catch (reason) {
        setError(describeApiError(reason, `Couldn’t attach “${file.name}”.`));
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const download = async (attachmentId: string, filename: string) => {
    setError(null);
    try {
      const blob = await fetchFile(noteId, attachmentId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      // Give the browser a moment to start the download before releasing the blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t download the file."));
    }
  };

  const remove = async (attachmentId: string) => {
    setError(null);
    try {
      await mutations.removeAttachment.mutateAsync({ noteId, attachmentId });
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t remove the file."));
    }
  };

  return (
    <Section
      title="Attachments"
      action={
        readOnly ? null : (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPTED}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => void upload(event.target.files)}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip aria-hidden="true" />
              {busy ? "Uploading…" : "Attach"}
            </Button>
          </>
        )
      }
    >
      <FormAlert message={error} />
      {attachments.status === "loading" ? (
        <Skeleton className="h-8 w-full" />
      ) : attachments.status === "error" ? (
        <p className="text-destructive">{attachments.message}</p>
      ) : attachments.data.attachments.length === 0 ? (
        <p className="text-muted-foreground">
          No files. Images, PDFs, text, and Office documents up to{" "}
          {formatBytes(attachments.data.max_bytes)}.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {attachments.data.attachments.map((file) => (
            <li
              key={file.id}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60"
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{file.filename}</span>
                <span className="block text-xs text-muted-foreground">
                  {file.content_type.split("/").at(-1)?.toUpperCase()} ·{" "}
                  {formatBytes(file.size_bytes)}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Download “${file.filename}”`}
                onClick={() => void download(file.id, file.filename)}
                className="flex size-7 items-center justify-center rounded text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Download className="size-3.5" aria-hidden="true" />
              </button>
              {readOnly ? null : (
                <button
                  type="button"
                  aria-label={`Remove “${file.filename}”`}
                  onClick={() => void remove(file.id)}
                  className="flex size-7 items-center justify-center rounded text-muted-foreground outline-none hover:bg-background hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
