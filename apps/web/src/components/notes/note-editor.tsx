"use client";

import type { Note } from "@orbit/contracts";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import { AlertTriangle, Check, CloudOff, Loader2 } from "lucide-react";
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { type NoteAutosave, type SaveStatus, useNoteAutosave } from "@/hooks/use-note-autosave";
import {
  asJsonContent,
  looksLikeMarkdown,
  noteExtensions,
  noteHref,
  noteIdFromHref,
  toNoteContent,
} from "@/lib/note-content";
import { noteDisplayTitle } from "@/lib/notes";
import { cn } from "@/utils/common";

import { EditorToolbar } from "./editor-toolbar";
import { LinkDialog, NotePickerDialog } from "./pickers";

/** What the page can ask of the open editor. */
export type NoteEditorHandle = {
  /** Save pending changes now; `false` if they couldn't be saved. */
  flush: () => Promise<boolean>;
  /** The document as the user currently sees it, for export. */
  snapshot: () => Pick<Note, "title" | "content">;
};

type NoteEditorProps = {
  workspaceId: string;
  note: Note;
  /** Archived and trashed notes are shown but not edited. */
  readOnly: boolean;
  handleRef: RefObject<NoteEditorHandle | null>;
  /** Open another note (from an internal link). */
  onOpenNote: (noteId: string) => void;
};

/**
 * The note's title and document. Typing saves automatically (see `useNoteAutosave`); the status
 * beside the title only says "Saved" once the server has confirmed it.
 */
export function NoteEditor({
  workspaceId,
  note,
  readOnly,
  handleRef,
  onOpenNote,
}: NoteEditorProps) {
  const autosave = useNoteAutosave(workspaceId, note);
  const [title, setTitle] = useState(note.title);
  const [dialog, setDialog] = useState<"link" | "note" | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const { edit } = autosave;

  const editor = useEditor({
    extensions: [
      ...noteExtensions(),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading"
            ? "Heading"
            : "Write, or type # for a heading, - for a list…",
      }),
    ],
    content: asJsonContent(note.content),
    editable: !readOnly,
    // Rendered on the client only; the server never sees the document.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "note-prose min-h-[50vh] outline-none",
        "aria-label": "Note text",
        "aria-multiline": "true",
        role: "textbox",
      },
      handlePaste: (view, event) => {
        // Plain text that looks like Markdown becomes formatted content. Pastes with HTML (from
        // a web page or another editor) keep the browser's formatting instead.
        const data = event.clipboardData;
        if (!data || data.types.includes("text/html")) return false;
        const text = data.getData("text/plain");
        if (!text || !looksLikeMarkdown(text) || !view.editable) return false;
        event.preventDefault();
        editorRef.current?.commands.insertContent(text, { contentType: "markdown" });
        return true;
      },
      handleClick: (_view, _pos, event) => {
        const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
        const href = anchor?.getAttribute("href");
        if (!href) return false;
        const target = noteIdFromHref(href);
        if (target) {
          event.preventDefault();
          onOpenNoteRef.current(target);
          return true;
        }
        // Web links open in a new tab with Cmd/Ctrl-click, or with any click when reading.
        if (event.metaKey || event.ctrlKey || readOnlyRef.current) {
          event.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => edit({ content: toNoteContent(current.getJSON()) }),
  });

  // Callbacks used by editor props, which are fixed when the editor is created.
  const editorRef = useRef(editor);
  const onOpenNoteRef = useRef(onOpenNote);
  const readOnlyRef = useRef(readOnly);
  useEffect(() => {
    editorRef.current = editor;
    onOpenNoteRef.current = onOpenNote;
    readOnlyRef.current = readOnly;
  });

  // A new, empty note starts in its title.
  useEffect(() => {
    if (!readOnly && note.revision === 1 && !note.title && note.note_type !== "journal") {
      titleRef.current?.focus();
    }
    // Only when the note first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus once per note
  }, [note.id]);

  useImperativeHandle(
    handleRef,
    () => ({
      flush: autosave.flush,
      snapshot: () => ({
        title,
        content: editor ? toNoteContent(editor.getJSON()) : note.content,
      }),
    }),
    [autosave.flush, editor, note.content, title],
  );

  const resolve = useCallback(
    async (choice: "mine" | "theirs") => {
      const latest = await autosave.resolveConflict(choice);
      if (latest) {
        setTitle(latest.title);
        editor?.commands.setContent(asJsonContent(latest.content), { emitUpdate: false });
      }
    },
    [autosave, editor],
  );

  const onTitleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" || (event.key === "ArrowDown" && !event.shiftKey)) {
      // The title is one line; Enter moves into the text.
      event.preventDefault();
      editor?.commands.focus("start");
    }
  };

  const linkHref = editor?.getAttributes("link").href;
  const placeholderTitle = noteDisplayTitle({ ...note, title: "" });

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <textarea
          ref={titleRef}
          value={title}
          rows={1}
          maxLength={200}
          readOnly={readOnly}
          aria-label="Title"
          placeholder={placeholderTitle}
          onChange={(event) => {
            const next = event.target.value.replace(/[\r\n]+/g, " ");
            setTitle(next);
            edit({ title: next });
          }}
          onKeyDown={onTitleKeyDown}
          className="field-sizing-content min-w-0 flex-1 resize-none bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60 @3xl/editor:text-3xl"
        />
        {readOnly ? null : <SaveIndicator autosave={autosave} />}
      </div>

      {autosave.status === "conflict" ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm @2xl/editor:flex-row @2xl/editor:items-center"
        >
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />
          <p className="flex-1">
            This note was changed somewhere else since you opened it. Your latest edits haven’t been
            saved.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void resolve("theirs")}>
              Load their version
            </Button>
            <Button size="sm" onClick={() => void resolve("mine")}>
              Keep mine
            </Button>
          </div>
        </div>
      ) : null}

      {editor && !readOnly ? (
        <div className="sticky top-0 z-10 -mx-2 rounded-lg bg-background/90 px-1 backdrop-blur-sm">
          <EditorToolbar
            editor={editor}
            onLink={() => setDialog("link")}
            onNoteLink={() => setDialog("note")}
          />
        </div>
      ) : null}

      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        <div aria-hidden="true" className="min-h-[50vh]" />
      )}

      {dialog === "link" && editor ? (
        <LinkDialog
          initial={typeof linkHref === "string" && !noteIdFromHref(linkHref) ? linkHref : ""}
          onClose={() => setDialog(null)}
          onRemove={linkHref ? () => editor.chain().focus().unsetLink().run() : undefined}
          onSubmit={(href) => {
            const chain = editor.chain().focus();
            if (editor.state.selection.empty && !editor.isActive("link")) {
              chain
                .insertContent({
                  type: "text",
                  text: href,
                  marks: [{ type: "link", attrs: { href } }],
                })
                .run();
            } else {
              chain.extendMarkRange("link").setLink({ href }).run();
            }
          }}
        />
      ) : null}
      {dialog === "note" && editor ? (
        <NotePickerDialog
          workspaceId={workspaceId}
          excludeId={note.id}
          onClose={() => setDialog(null)}
          onPick={(target) => {
            const href = noteHref(target.id);
            const chain = editor.chain().focus();
            if (editor.state.selection.empty) {
              chain
                .insertContent([
                  {
                    type: "text",
                    text: noteDisplayTitle(target),
                    marks: [{ type: "link", attrs: { href } }],
                  },
                  { type: "text", text: " " },
                ])
                .run();
            } else {
              chain.setLink({ href }).run();
            }
          }}
        />
      ) : null}
    </div>
  );
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  retrying: "Retrying…",
  error: "Not saved",
  conflict: "Not saved",
};

function SaveIndicator({ autosave }: { autosave: NoteAutosave }) {
  const { status, error, retry } = autosave;
  const Icon =
    status === "saved"
      ? Check
      : status === "saving" || status === "retrying"
        ? Loader2
        : status === "error" || status === "conflict"
          ? CloudOff
          : null;
  return (
    <div className="flex shrink-0 items-center gap-2 pt-2 text-xs">
      <span
        role="status"
        title={error ?? undefined}
        className={cn(
          "flex items-center gap-1.5 text-muted-foreground",
          (status === "error" || status === "conflict") && "text-destructive",
        )}
      >
        {Icon ? (
          <Icon
            className={cn(
              "size-3.5",
              (status === "saving" || status === "retrying") && "animate-spin",
            )}
            aria-hidden="true"
          />
        ) : (
          <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
        )}
        {STATUS_TEXT[status]}
        {status === "error" && error ? <span className="sr-only">: {error}</span> : null}
      </span>
      {status === "error" ? (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={retry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
