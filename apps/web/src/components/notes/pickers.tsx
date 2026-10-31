"use client";

import type { NoteSummary, Task } from "@orbit/contracts";
import { CheckSquare, NotebookPen, Search, X } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";

import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { useNoteList } from "@/hooks/use-notes";
import { useTaskList } from "@/hooks/use-tasks";
import { isAllowedHref } from "@/lib/note-content";
import { noteDisplayTitle } from "@/lib/notes";
import { cn } from "@/utils/common";

const SEARCH_DELAY_MS = 200;

function useDebounced(value: string, delay = SEARCH_DELAY_MS): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value.trim()), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function PickerFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const id = useId();
  const { close, dialogProps } = useModalDialog({ onClose });
  return (
    <dialog
      {...dialogProps}
      aria-labelledby={id}
      className="dialog-motion dialog-pop mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Close" onClick={close}>
          <X aria-hidden="true" />
        </Button>
      </div>
      {children(close)}
    </dialog>
  );
}

/** Asks for a web or email address. Bare domains get `https://`. */
export function LinkDialog({
  initial,
  onSubmit,
  onRemove,
  onClose,
}: {
  initial: string;
  onSubmit: (href: string) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  return (
    <PickerFrame title={initial ? "Edit link" : "Add a link"} onClose={onClose}>
      {(close) => {
        const submit = (event: FormEvent) => {
          event.preventDefault();
          const trimmed = value.trim();
          const href =
            /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("/")
              ? trimmed
              : `https://${trimmed}`;
          if (!trimmed || !isAllowedHref(href)) {
            setError("Enter a web address (https://…) or an email link (mailto:…).");
            return;
          }
          onSubmit(href);
          close();
        };
        return (
          <form noValidate onSubmit={submit} className="space-y-3 p-4">
            <label htmlFor={inputId} className="text-sm font-medium">
              Address
            </label>
            <Input
              id={inputId}
              autoFocus
              value={value}
              placeholder="https://example.com"
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
            />
            <FormAlert message={error} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {onRemove ? (
                <Button
                  variant="ghost"
                  className="sm:mr-auto"
                  onClick={() => {
                    onRemove();
                    close();
                  }}
                >
                  Remove link
                </Button>
              ) : null}
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit">Apply</Button>
            </div>
          </form>
        );
      }}
    </PickerFrame>
  );
}

type PickerListProps<T> = {
  label: string;
  placeholder: string;
  search: string;
  onSearchChange: (value: string) => void;
  items: readonly T[] | null;
  error: string | null;
  empty: string;
  itemKey: (item: T) => string;
  render: (item: T) => ReactNode;
  onPick: (item: T) => void;
};

/** A search field and its results as a listbox (the combobox pattern). */
function PickerList<T>({
  label,
  placeholder,
  search,
  onSearchChange,
  items,
  error,
  empty,
  itemKey,
  render,
  onPick,
}: PickerListProps<T>) {
  const listId = useId();
  const [active, setActive] = useState(0);
  const count = items?.length ?? 0;
  const current = count ? Math.min(active, count - 1) : -1;
  const optionId = (index: number) => `${listId}-${index}`;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && count) {
      event.preventDefault();
      setActive((current + 1) % count);
    } else if (event.key === "ArrowUp" && count) {
      event.preventDefault();
      setActive((current - 1 + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items?.[current];
      if (item) onPick(item);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 border-b px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          autoFocus
          role="combobox"
          aria-label={label}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={current >= 0 ? optionId(current) : undefined}
          value={search}
          placeholder={placeholder}
          onChange={(event) => {
            onSearchChange(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div id={listId} role="listbox" aria-label="Results" className="max-h-72 overflow-y-auto p-2">
        {error ? (
          <p role="alert" className="px-2 py-6 text-center text-sm text-destructive">
            {error}
          </p>
        ) : items === null ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">Searching…</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          items.map((item, index) => (
            <div
              key={itemKey(item)}
              id={optionId(index)}
              role="option"
              tabIndex={-1}
              aria-selected={index === current}
              onClick={() => onPick(item)}
              onPointerMove={() => {
                if (index !== current) setActive(index);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm select-none",
                index === current && "bg-accent text-accent-foreground",
              )}
            >
              {render(item)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Finds a note to link to. Excludes `excludeId` (the note being edited). */
export function NotePickerDialog({
  workspaceId,
  excludeId,
  title = "Link to a note",
  onPick,
  onClose,
}: {
  workspaceId: string;
  excludeId?: string;
  title?: string;
  onPick: (note: NoteSummary) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const { state } = useNoteList(workspaceId, {
    q: q || undefined,
    sort: q ? "updated_at" : "recent",
    limit: 20,
  });
  const notes =
    state.status === "success" ? state.data.notes.filter((note) => note.id !== excludeId) : null;

  return (
    <PickerFrame title={title} onClose={onClose}>
      {(close) => (
        <PickerList
          label="Search notes"
          placeholder="Search notes…"
          search={search}
          onSearchChange={setSearch}
          items={notes}
          error={state.status === "error" ? state.message : null}
          empty={q ? `No notes match “${q}”.` : "No other notes yet."}
          itemKey={(note) => note.id}
          onPick={(note) => {
            onPick(note);
            close();
          }}
          render={(note) => (
            <>
              <NotebookPen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{noteDisplayTitle(note)}</span>
                {note.excerpt ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {note.excerpt}
                  </span>
                ) : null}
              </span>
            </>
          )}
        />
      )}
    </PickerFrame>
  );
}

/** Finds an open or completed task in the workspace to link. */
export function TaskPickerDialog({
  workspaceId,
  excludeIds,
  onPick,
  onClose,
}: {
  workspaceId: string;
  excludeIds: readonly string[];
  onPick: (task: Task) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const { state } = useTaskList(workspaceId, { q: q || undefined, limit: 20 });
  const tasks =
    state.status === "success"
      ? state.data.tasks.filter((task) => !excludeIds.includes(task.id))
      : null;
  const error = state.status === "error" ? state.message : null;

  return (
    <PickerFrame title="Link a task" onClose={onClose}>
      {(close) => (
        <PickerList
          label="Search tasks"
          placeholder="Search tasks…"
          search={search}
          onSearchChange={setSearch}
          items={tasks}
          error={error}
          empty={q ? `No tasks match “${q}”.` : "No tasks to link yet."}
          itemKey={(task) => task.id}
          onPick={(task) => {
            onPick(task);
            close();
          }}
          render={(task) => (
            <>
              <CheckSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  task.status === "completed" && "text-muted-foreground line-through",
                )}
              >
                {task.title}
              </span>
            </>
          )}
        />
      )}
    </PickerFrame>
  );
}
