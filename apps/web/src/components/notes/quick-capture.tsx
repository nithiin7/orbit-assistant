"use client";

import { NotebookPen, X } from "lucide-react";
import Link from "next/link";
import {
  createContext,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { useNoteMutations } from "@/hooks/use-notes";
import { looksLikeMarkdown, markdownToDocument } from "@/lib/note-content";
import { notesHref } from "@/lib/notes";
import { useWorkspaces } from "@/providers/workspace";

type QuickCaptureContextValue = { open: () => void };

const QuickCaptureContext = createContext<QuickCaptureContextValue | null>(null);

export function useQuickCapture(): QuickCaptureContextValue {
  const context = useContext(QuickCaptureContext);
  if (!context) throw new Error("useQuickCapture must be used within QuickCaptureProvider.");
  return context;
}

/**
 * Capture a thought from anywhere without leaving the page: a small dialog that saves a quick
 * note to the active workspace's Inbox. Opened from the command palette or the sidebar.
 */
export function QuickCaptureProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Remounts the dialog each time, so it starts empty.
  const [session, setSession] = useState(0);
  const value = useMemo(
    () => ({
      open: () => {
        setSession((current) => current + 1);
        setOpen(true);
      },
    }),
    [],
  );
  return (
    <QuickCaptureContext.Provider value={value}>
      {children}
      {open ? <QuickCaptureDialog key={session} onClose={() => setOpen(false)} /> : null}
    </QuickCaptureContext.Provider>
  );
}

function QuickCaptureDialog({ onClose }: { onClose: () => void }) {
  const { state } = useWorkspaces();
  const workspaceId = state.status === "ready" ? state.active.id : null;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const headingId = useId();
  const bodyId = useId();

  const attach = useCallback((dialog: HTMLDialogElement | null) => {
    dialogRef.current = dialog;
    if (dialog && !dialog.open) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
  }, []);

  const dirty = !saved && (title.trim() !== "" || text.trim() !== "");
  const close = () => dialogRef.current?.close();
  /** Closing with something typed asks first, so a stray Escape doesn't lose it. */
  const requestClose = () => {
    if (dirty && !window.confirm("Discard this note?")) return;
    close();
  };

  return (
    <dialog
      ref={attach}
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) requestClose();
      }}
      onClose={() => {
        returnFocus.current?.focus();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) requestClose();
      }}
      className="dialog-motion dialog-pop mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      {workspaceId ? (
        saved ? (
          <div className="space-y-4 p-5" role="status">
            <h2 id={headingId} className="text-base font-semibold">
              Saved to your Inbox
            </h2>
            <p className="text-sm text-muted-foreground">
              Find it in Notes when you’re ready to organize it.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                Done
              </Button>
              <Link
                href={notesHref({ view: "inbox", noteId: saved.id })}
                onClick={close}
                className={buttonVariants()}
              >
                Open note
              </Link>
            </div>
          </div>
        ) : (
          <CaptureForm
            workspaceId={workspaceId}
            headingId={headingId}
            bodyId={bodyId}
            title={title}
            text={text}
            busy={busy}
            error={error}
            onTitleChange={setTitle}
            onTextChange={setText}
            onCancel={requestClose}
            onBusy={setBusy}
            onError={setError}
            onSaved={setSaved}
          />
        )
      ) : (
        <p className="p-5 text-sm text-muted-foreground">Loading your workspace…</p>
      )}
    </dialog>
  );
}

function CaptureForm({
  workspaceId,
  headingId,
  bodyId,
  title,
  text,
  busy,
  error,
  onTitleChange,
  onTextChange,
  onCancel,
  onBusy,
  onError,
  onSaved,
}: {
  workspaceId: string;
  headingId: string;
  bodyId: string;
  title: string;
  text: string;
  busy: boolean;
  error: string | null;
  onTitleChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onCancel: () => void;
  onBusy: (busy: boolean) => void;
  onError: (message: string | null) => void;
  onSaved: (note: { id: string }) => void;
}) {
  const { create } = useNoteMutations(workspaceId);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!title.trim() && !text.trim()) {
      onError("Write something first.");
      return;
    }
    onBusy(true);
    onError(null);
    try {
      // Markdown typed or pasted here keeps its formatting; anything else is plain paragraphs.
      const body = looksLikeMarkdown(text) ? { content: markdownToDocument(text) } : { text };
      const note = await create.mutateAsync({ title: title.trim(), note_type: "quick", ...body });
      onSaved(note);
    } catch (reason) {
      onError(describeApiError(reason, "Couldn’t save the note. Try again."));
    }
    onBusy(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      onKeyDown={onKeyDown}
      className="space-y-3 p-5"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold">
          <NotebookPen className="size-4 text-brand" aria-hidden="true" />
          Quick note
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-1.5 size-8"
          aria-label="Close"
          onClick={onCancel}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <input
        value={title}
        maxLength={200}
        aria-label="Title (optional)"
        placeholder="Title (optional)"
        onChange={(event) => onTitleChange(event.target.value)}
        className="w-full bg-transparent text-base font-medium outline-none placeholder:text-muted-foreground"
      />
      <label htmlFor={bodyId} className="sr-only">
        Note
      </label>
      <textarea
        id={bodyId}
        autoFocus
        value={text}
        rows={6}
        maxLength={20000}
        placeholder="What’s on your mind? Markdown works."
        onChange={(event) => onTextChange(event.target.value)}
        className="w-full resize-y rounded-lg border border-input bg-card p-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-transparent"
      />
      <FormAlert message={error} />
      <div className="flex items-center justify-between gap-2">
        <p className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd> to save
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save to Inbox"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** The sidebar's entry point to quick capture. */
export function QuickCaptureButton({ className }: { className?: string }) {
  const { open } = useQuickCapture();
  return (
    <Tooltip label="Quick note">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Quick note"
        aria-haspopup="dialog"
        onClick={open}
        className={className}
      >
        <NotebookPen aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}
