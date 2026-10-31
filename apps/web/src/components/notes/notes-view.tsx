"use client";

import type { Note, NoteFolder, NoteSort, NoteSummary, Tag } from "@orbit/contracts";
import {
  ArchiveRestore,
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileUp,
  LayoutGrid,
  List,
  type LucideIcon,
  MoreHorizontal,
  NotebookPen,
  PanelLeft,
  PanelRight,
  Pin,
  Plus,
  Search,
  SearchX,
  Star,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  useNote,
  useNoteCounts,
  useNoteFolders,
  useNoteList,
  useNoteMutations,
  useTags,
} from "@/hooks/use-notes";
import {
  documentToMarkdown,
  markdownToDocument,
  titleFromMarkdown,
  withoutTitleHeading,
} from "@/lib/note-content";
import {
  exportFileName,
  formatJournalDate,
  isReadOnly,
  journalToday,
  NOTE_SORTS,
  NOTE_VIEWS,
  noteDisplayTitle,
  NOTES_PAGE_SIZE,
  notesHref,
  type NotesLocation,
  parseNotesLocation,
  toNoteListQuery,
} from "@/lib/notes";
import { useCurrentUser } from "@/providers/auth";
import { useWorkspaces } from "@/providers/workspace";
import { cn } from "@/utils/common";
import { addDays } from "@/utils/dates";
import { isEditableTarget } from "@/utils/keyboard";

import { NoteDetails } from "./note-details";
import { NoteEditor, type NoteEditorHandle } from "./note-editor";
import { type NoteLayout, NoteList, type NoteListAction } from "./note-list";
import { NotesRail, VIEW_ICONS } from "./notes-rail";
import { FolderPickerDialog } from "./organize-dialogs";
import { useQuickCapture } from "./quick-capture";

const SEARCH_DELAY_MS = 250;
const LAYOUT_KEY = "orbit:notes-layout";
const DETAILS_KEY = "orbit:notes-details";

/** The Notes page for the active workspace. Remounts (and resets) when the workspace changes. */
export function NotesPanel() {
  const { state, refresh } = useWorkspaces();
  if (state.status === "error") {
    return (
      <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
        <p>{state.message}</p>
        <Button variant="outline" size="sm" onClick={refresh}>
          Try again
        </Button>
      </div>
    );
  }
  if (state.status === "loading") return <ListSkeleton />;
  return <NotesView key={state.active.id} workspaceId={state.active.id} />;
}

function viewTitle(location: NotesLocation, folders: readonly NoteFolder[], tags: readonly Tag[]) {
  if (location.folderId) return folders.find((f) => f.id === location.folderId)?.name ?? "Folder";
  if (location.tagId) {
    const tag = tags.find((t) => t.id === location.tagId);
    return tag ? `#${tag.name}` : "Tag";
  }
  return NOTE_VIEWS.find((view) => view.id === location.view)?.label ?? "Notes";
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function NotesView({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const location = useMemo(() => parseNotesLocation(params), [params]);
  const user = useCurrentUser();
  const { open: openQuickCapture } = useQuickCapture();

  const [search, setSearch] = useState(location.search);
  const [appliedSearch, setAppliedSearch] = useState(location.search.trim());
  const [sort, setSort] = useState<NoteSort>("updated_at");
  const [layout, setLayout] = useState<NoteLayout>(() =>
    typeof window !== "undefined" && window.localStorage.getItem(LAYOUT_KEY) === "grid"
      ? "grid"
      : "list",
  );
  const [page, setPage] = useState(0);
  const [railOpen, setRailOpen] = useState(false);
  // While a note is open, the list slides in over it on request.
  const [listOpen, setListOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState<NoteSummary | Note | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<NoteEditorHandle | null>(null);

  const counts = useNoteCounts(workspaceId);
  const { folders } = useNoteFolders(workspaceId);
  const tags = useTags(workspaceId);
  const mutations = useNoteMutations(workspaceId);
  const { confirm, confirmDialog } = useConfirm();

  const query = useMemo(
    () => ({ ...toNoteListQuery(location, sort, appliedSearch), offset: page * NOTES_PAGE_SIZE }),
    [location, sort, appliedSearch, page],
  );
  const { state: list, refreshing, reload } = useNoteList(workspaceId, query);

  // Search follows the box after a pause; the URL keeps it, so Back and reloads keep it too.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim();
      setAppliedSearch(next);
      setPage(0);
      if (next !== location.search.trim()) {
        router.replace(notesHref({ ...location, search: next }), { scroll: false });
      }
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
    // Only the typed text starts a search; navigating carries the search along by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [search]);

  /** Go somewhere in Notes, saving the open note first. */
  const navigate = useCallback(
    async (next: Partial<NotesLocation>, { keepNote = false }: { keepNote?: boolean } = {}) => {
      const target: NotesLocation = {
        view: next.view ?? (next.folderId || next.tagId ? "all" : location.view),
        folderId: next.folderId ?? (next.view || next.tagId ? null : location.folderId),
        tagId: next.tagId ?? (next.view || next.folderId ? null : location.tagId),
        noteId: next.noteId !== undefined ? next.noteId : keepNote ? location.noteId : null,
        search: next.search ?? search,
      };
      if (target.noteId !== location.noteId && location.noteId && editorRef.current) {
        const saved = await editorRef.current.flush();
        if (
          !saved &&
          !window.confirm("This note has changes that couldn’t be saved. Leave anyway?")
        ) {
          return;
        }
      }
      if (next.view || next.folderId || next.tagId) {
        setPage(0);
        setRailOpen(false);
      }
      if (target.noteId !== location.noteId) setListOpen(false);
      router.push(notesHref(target), { scroll: false });
    },
    [location, router, search],
  );

  const openNote = useCallback(
    (noteId: string) => {
      void navigate({ noteId }, { keepNote: true });
      mutations.opened.mutate(noteId);
    },
    [mutations.opened, navigate],
  );

  const setNotePending = (noteId: string, isPending: boolean) =>
    setPending((current) => {
      const next = new Set(current);
      if (isPending) next.add(noteId);
      else next.delete(noteId);
      return next;
    });

  const createNote = useCallback(
    async (type: "note" | "quick" = "note") => {
      setError(null);
      try {
        const tag = location.tagId ? tags.find((t) => t.id === location.tagId) : undefined;
        const note = await mutations.create.mutateAsync({
          title: "",
          note_type: type,
          folder_id: location.folderId,
          tags: tag ? [tag.name] : [],
        });
        const stay = location.folderId || location.tagId || location.view === "inbox";
        await navigate(
          { ...(stay ? {} : { view: "inbox" as const }), noteId: note.id },
          { keepNote: true },
        );
      } catch (reason) {
        setError(describeApiError(reason, "Couldn’t create a note. Try again."));
      }
    },
    [location, mutations.create, navigate, tags],
  );

  const openJournal = useCallback(
    async (date: string) => {
      setError(null);
      try {
        const entry = await mutations.openJournal.mutateAsync(date);
        await navigate({ view: "journal", noteId: entry.id });
      } catch (reason) {
        setError(describeApiError(reason, "Couldn’t open the journal. Try again."));
      }
    },
    [mutations.openJournal, navigate],
  );

  const importMarkdown = async (files: FileList | null) => {
    const file = files?.[0];
    if (importRef.current) importRef.current.value = "";
    if (!file) return;
    setError(null);
    try {
      if (file.size > 900_000) throw new Error("too large");
      const text = await file.text();
      const note = await mutations.create.mutateAsync({
        title: titleFromMarkdown(text, file.name.replace(/\.(md|markdown|txt)$/i, "")),
        content: markdownToDocument(withoutTitleHeading(text)),
        note_type: "note",
        folder_id: location.folderId,
      });
      setAnnouncement(`Imported “${noteDisplayTitle(note)}”.`);
      await navigate({ noteId: note.id }, { keepNote: true });
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message === "too large"
          ? "That file is too large to import as one note."
          : describeApiError(reason, "Couldn’t import that file. Check it’s Markdown or text."),
      );
    }
  };

  const act = useCallback(
    async (note: NoteSummary | Note, action: NoteListAction) => {
      setError(null);
      const title = noteDisplayTitle(note);
      if (action === "move") {
        setMoving(note);
        return;
      }
      if (
        action === "delete" &&
        !(await confirm({
          title: `Delete “${title}” forever?`,
          description: "This can’t be undone.",
          confirmLabel: "Delete forever",
          destructive: true,
        }))
      ) {
        return;
      }
      setNotePending(note.id, true);
      try {
        switch (action) {
          case "pin":
            await mutations.update.mutateAsync({
              noteId: note.id,
              changes: { is_pinned: !note.is_pinned },
            });
            setAnnouncement(note.is_pinned ? `Unpinned “${title}”.` : `Pinned “${title}”.`);
            break;
          case "favorite":
            await mutations.update.mutateAsync({
              noteId: note.id,
              changes: { is_favorite: !note.is_favorite },
            });
            setAnnouncement(
              note.is_favorite
                ? `Removed “${title}” from favorites.`
                : `Added “${title}” to favorites.`,
            );
            break;
          case "archive": {
            const archiving = note.archived_at === null;
            if (archiving && note.id === location.noteId) await editorRef.current?.flush();
            await mutations.update.mutateAsync({
              noteId: note.id,
              changes: { archived: archiving },
            });
            setAnnouncement(archiving ? `Archived “${title}”.` : `Unarchived “${title}”.`);
            break;
          }
          case "duplicate": {
            if (note.id === location.noteId) await editorRef.current?.flush();
            const copy = await mutations.act.mutateAsync({ noteId: note.id, action: "duplicate" });
            setAnnouncement(`Duplicated “${title}”.`);
            await navigate({ noteId: copy.id }, { keepNote: true });
            break;
          }
          case "trash":
            if (note.id === location.noteId) await editorRef.current?.flush();
            await mutations.act.mutateAsync({ noteId: note.id, action: "trash" });
            setAnnouncement(`Moved “${title}” to the Trash.`);
            if (note.id === location.noteId) await navigate({ noteId: null });
            break;
          case "restore":
            await mutations.act.mutateAsync({ noteId: note.id, action: "restore" });
            setAnnouncement(`Restored “${title}”.`);
            break;
          case "delete":
            await mutations.remove.mutateAsync(note.id);
            setAnnouncement(`Deleted “${title}” forever.`);
            if (note.id === location.noteId) await navigate({ noteId: null });
            break;
        }
      } catch (reason) {
        setError(describeApiError(reason, "That didn’t work. Try again."));
      }
      setNotePending(note.id, false);
    },
    [confirm, location.noteId, mutations, navigate],
  );

  // Keyboard: / searches, N starts a note (unless typing or a dialog is open), Escape clears.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target) || document.querySelector("dialog[open]")) return;
      if (event.key === "/") {
        event.preventDefault();
        // With a note open, the search lives in the list panel, which focuses it as it opens.
        if (searchRef.current) searchRef.current.focus();
        else setListOpen(true);
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createNote();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [createNote]);

  const title = viewTitle(location, folders, tags);
  const today = journalToday(user.timezone);
  const noteOpen = location.noteId !== null;
  const total = list.status === "success" ? list.data.total : 0;
  const pages = Math.max(1, Math.ceil(total / NOTES_PAGE_SIZE));
  const ViewIcon = location.folderId || location.tagId ? null : VIEW_ICONS[location.view];

  const newItems: MenuItem[] = [
    {
      id: "note",
      label: "Note",
      description: "Press N on this page",
      icon: NotebookPen,
      onSelect: () => void createNote(),
    },
    {
      id: "quick",
      label: "Quick note",
      description: "Capture without leaving the page",
      icon: Zap,
      onSelect: openQuickCapture,
    },
    {
      id: "journal",
      label: "Today’s journal entry",
      icon: BookOpen,
      onSelect: () => void openJournal(today),
    },
    {
      id: "import",
      label: "Import Markdown…",
      icon: FileUp,
      onSelect: () => importRef.current?.click(),
    },
  ];

  const rail = (
    <NotesRail
      workspaceId={workspaceId}
      location={location}
      counts={counts}
      folders={folders}
      tags={tags}
      onNavigate={(next) => void navigate(next)}
      onAnnounce={setAnnouncement}
    />
  );

  const newMenu = (
    <Menu items={newItems} align="end">
      <Plus aria-hidden="true" />
      New
    </Menu>
  );

  /** The search, filters, and note list: inline while browsing, in a panel over an open note. */
  const listContent = (inPanel: boolean) => (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2
          id="note-list-heading"
          className="flex min-w-0 items-center gap-2 text-lg font-semibold tracking-tight"
        >
          {ViewIcon ? (
            <ViewIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : null}
          <span className="truncate">{title}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn(!inPanel && "@5xl/notes:hidden")}
            aria-expanded={railOpen}
            aria-controls="notes-rail-panel"
            onClick={() => setRailOpen((open) => !open)}
          >
            Browse
          </Button>
          {inPanel ? (
            <>
              {newMenu}
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Close note list"
                onClick={() => setListOpen(false)}
              >
                <X aria-hidden="true" />
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {railOpen ? (
        <div
          id="notes-rail-panel"
          className={cn("rounded-xl border bg-card p-2", !inPanel && "@5xl/notes:hidden")}
        >
          {rail}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            ref={searchRef}
            type="search"
            value={search}
            aria-label="Search notes"
            aria-keyshortcuts="/"
            placeholder="Search notes…"
            // The panel opens to find another note, so it starts in the search.
            autoFocus={inPanel}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && search) {
                event.preventDefault();
                setSearch("");
              }
            }}
            className="h-9 w-full rounded-md border border-input bg-card pr-3 pl-8 text-sm shadow-elevation-1 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-transparent"
          />
        </div>
        {location.view === "recent" || location.view === "journal" ? null : (
          <Select
            aria-label="Sort notes"
            value={sort}
            onValueChange={(value) => {
              setSort(value);
              setPage(0);
            }}
            options={NOTE_SORTS}
            className="w-36 shrink-0"
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label={layout === "list" ? "Show as grid" : "Show as list"}
          onClick={() => {
            const next = layout === "list" ? "grid" : "list";
            setLayout(next);
            window.localStorage.setItem(LAYOUT_KEY, next);
          }}
        >
          {layout === "list" ? <LayoutGrid aria-hidden="true" /> : <List aria-hidden="true" />}
        </Button>
      </div>

      {location.view === "journal" && !location.folderId && !location.tagId ? (
        <JournalBar today={today} onOpen={(date) => void openJournal(date)} />
      ) : null}
      {location.view === "trash" && total > 0 ? (
        <TrashBar
          onEmpty={async () => {
            const confirmed = await confirm({
              title: "Empty the Trash?",
              description: `${total} ${total === 1 ? "note" : "notes"} will be deleted forever. This can’t be undone.`,
              confirmLabel: "Empty Trash",
              destructive: true,
            });
            if (!confirmed) return;
            try {
              const { deleted } = await mutations.empty.mutateAsync();
              setAnnouncement(`Deleted ${deleted} ${deleted === 1 ? "note" : "notes"} forever.`);
              if (location.noteId) await navigate({ noteId: null });
            } catch (reason) {
              setError(describeApiError(reason, "Couldn’t empty the Trash."));
            }
          }}
        />
      ) : null}

      <div
        aria-busy={list.status === "loading" || refreshing}
        className={cn("transition-opacity duration-150", refreshing && "opacity-70")}
      >
        {list.status === "loading" ? (
          <ListSkeleton />
        ) : list.status === "error" ? (
          <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
            <p>{list.message}</p>
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : list.data.notes.length === 0 ? (
          <ListEmptyState
            location={location}
            search={appliedSearch}
            onClear={() => setSearch("")}
            onCreate={() => void createNote()}
            onJournal={() => void openJournal(today)}
          />
        ) : (
          <div className="space-y-3">
            <NoteList
              notes={list.data.notes}
              folders={folders}
              selectedId={location.noteId}
              search={appliedSearch}
              layout={layout}
              showFolder={!location.folderId}
              pending={pending}
              onOpen={(note) => openNote(note.id)}
              onAction={(note, action) => void act(note, action)}
            />
            <p className="px-1 text-xs text-muted-foreground" role="status">
              {total === 1 ? "1 note" : `${total} notes`}
              {pages > 1 ? ` · page ${page + 1} of ${pages}` : ""}
            </p>
            {pages > 1 ? (
              <div className="flex justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft aria-hidden="true" /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  Next <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="@container/notes space-y-5">
      {/* Hidden, not removed, while a note is open: the import input lives here. */}
      <header hidden={noteOpen} className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <div className="flex items-center gap-2">
          <input
            ref={importRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => void importMarkdown(event.target.files)}
          />
          {newMenu}
        </div>
      </header>

      <FormAlert message={error} />
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {location.noteId ? (
        // Editing: the note takes the whole page; the list slides in over it when asked for.
        <section aria-label="Note" className="min-w-0">
          <NotePane
            key={location.noteId}
            workspaceId={workspaceId}
            noteId={location.noteId}
            folders={folders}
            tags={tags}
            handleRef={editorRef}
            listOpen={listOpen}
            onShowList={() => setListOpen(true)}
            onBack={() => void navigate({ noteId: null })}
            onOpenNote={openNote}
            onAction={(note, action) => void act(note, action)}
            onAnnounce={setAnnouncement}
          />
          {listOpen ? (
            <NoteListPanel onClose={() => setListOpen(false)}>{listContent(true)}</NoteListPanel>
          ) : null}
        </section>
      ) : (
        // Browsing: the rail beside a list that uses the rest of the page.
        <div className="grid gap-6 @5xl/notes:grid-cols-[13rem_minmax(0,1fr)] @7xl/notes:grid-cols-[14rem_minmax(0,1fr)]">
          <aside className="hidden min-w-0 @5xl/notes:sticky @5xl/notes:top-6 @5xl/notes:block @5xl/notes:max-h-[calc(100dvh-3rem)] @5xl/notes:self-start @5xl/notes:overflow-y-auto">
            {rail}
          </aside>

          <section
            aria-labelledby="note-list-heading"
            className="@container/list min-w-0 space-y-3"
          >
            {listContent(false)}
          </section>
        </div>
      )}

      {moving ? (
        <FolderPickerDialog
          title={`Move “${noteDisplayTitle(moving)}”`}
          folders={folders}
          current={moving.folder_id}
          top="Inbox (no folder)"
          submitLabel="Move"
          onClose={() => setMoving(null)}
          onSubmit={async (folderId) => {
            await mutations.update.mutateAsync({
              noteId: moving.id,
              changes: { folder_id: folderId },
            });
            setAnnouncement(`Moved “${noteDisplayTitle(moving)}”.`);
          }}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

/** The note list as a drawer from the left edge, over the open note. */
function NoteListPanel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const { dialogProps } = useModalDialog({ onClose });
  return (
    <dialog
      {...dialogProps}
      aria-labelledby="note-list-heading"
      className="dialog-motion dialog-drawer m-0 h-dvh max-h-none w-[28rem] max-w-[calc(100%-3rem)] border-r bg-background p-0 text-foreground shadow-elevation-3"
    >
      <div className="@container/list h-full space-y-3 overflow-y-auto p-4">{children}</div>
    </dialog>
  );
}

function JournalBar({ today, onOpen }: { today: string; onOpen: (date: string) => void }) {
  const [date, setDate] = useState(today);
  const go = (next: string) => {
    setDate(next);
    onOpen(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2 shadow-elevation-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Previous day"
        onClick={() => go(addDays(date, -1))}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <DatePicker
        aria-label="Journal date"
        value={date}
        onValueChange={(value) => value && go(value)}
        className="min-w-0 flex-1"
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Next day"
        onClick={() => go(addDays(date, 1))}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
      <Button variant="soft" size="sm" onClick={() => go(today)}>
        Today
      </Button>
    </div>
  );
}

function TrashBar({ onEmpty }: { onEmpty: () => Promise<void> }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <span>Notes in the Trash can be restored until you delete them.</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-destructive hover:text-destructive"
        onClick={() => void onEmpty()}
      >
        Empty Trash
      </Button>
    </div>
  );
}

const EMPTY_COPY: Record<
  NotesLocation["view"],
  { icon: LucideIcon; title: string; description: string }
> = {
  inbox: {
    icon: NotebookPen,
    title: "Your Inbox is clear",
    description: "New and quick notes land here until you file them in a folder.",
  },
  all: {
    icon: NotebookPen,
    title: "No notes yet",
    description: "Capture ideas, plans, and reference material. Press N to start.",
  },
  recent: {
    icon: NotebookPen,
    title: "Nothing recent",
    description: "Notes you open or edit show up here.",
  },
  favorites: {
    icon: Star,
    title: "No favorites",
    description: "Star the notes you come back to most.",
  },
  pinned: {
    icon: Pin,
    title: "Nothing pinned",
    description: "Pin a note to keep it at the top of its lists.",
  },
  journal: {
    icon: BookOpen,
    title: "Start your journal",
    description: "One entry per day. Pick a date above, or start with today.",
  },
  archive: {
    icon: ArchiveRestore,
    title: "The archive is empty",
    description: "Archive notes to keep them without the clutter.",
  },
  trash: {
    icon: Trash2,
    title: "The Trash is empty",
    description: "Deleted notes wait here until you remove them for good.",
  },
};

function ListEmptyState({
  location,
  search,
  onClear,
  onCreate,
  onJournal,
}: {
  location: NotesLocation;
  search: string;
  onClear: () => void;
  onCreate: () => void;
  onJournal: () => void;
}) {
  if (search) {
    return (
      <EmptyState
        icon={SearchX}
        title="No matching notes"
        description={`Nothing here matches “${search}”. Search looks in titles, text, tags, and folder names.`}
      >
        <Button variant="outline" size="sm" onClick={onClear}>
          <X aria-hidden="true" /> Clear search
        </Button>
      </EmptyState>
    );
  }
  if (location.folderId || location.tagId) {
    return (
      <EmptyState
        icon={NotebookPen}
        title={location.folderId ? "This folder is empty" : "No notes with this tag"}
        description={
          location.folderId
            ? "Create a note here, or move notes in from their menu."
            : "Add the tag to a note from its details."
        }
      >
        <Button size="sm" onClick={onCreate}>
          <Plus aria-hidden="true" /> New note
        </Button>
      </EmptyState>
    );
  }
  const copy = EMPTY_COPY[location.view];
  return (
    <EmptyState icon={copy.icon} title={copy.title} description={copy.description}>
      {location.view === "journal" ? (
        <Button size="sm" onClick={onJournal}>
          Write today’s entry
        </Button>
      ) : location.view === "inbox" || location.view === "all" ? (
        <Button size="sm" onClick={onCreate}>
          <Plus aria-hidden="true" /> New note
        </Button>
      ) : null}
    </EmptyState>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden="true" className="divide-y overflow-hidden rounded-xl border bg-card">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="space-y-2 px-4 py-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      ))}
    </div>
  );
}

function NotePane({
  workspaceId,
  noteId,
  folders,
  tags,
  handleRef,
  listOpen,
  onShowList,
  onBack,
  onOpenNote,
  onAction,
  onAnnounce,
}: {
  workspaceId: string;
  noteId: string;
  folders: readonly NoteFolder[];
  tags: readonly Tag[];
  handleRef: RefObject<NoteEditorHandle | null>;
  listOpen: boolean;
  onShowList: () => void;
  onBack: () => void;
  onOpenNote: (noteId: string) => void;
  onAction: (note: Note, action: NoteListAction) => void;
  onAnnounce: (message: string) => void;
}) {
  const { state, reload } = useNote(workspaceId, noteId);
  const [showDetails, setShowDetails] = useState(
    () => typeof window === "undefined" || window.localStorage.getItem(DETAILS_KEY) !== "hidden",
  );

  if (state.status === "loading") {
    return (
      <div aria-hidden="true" className="space-y-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
        <p>{state.message}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack}>
            Back to notes
          </Button>
        </div>
      </div>
    );
  }

  const note = state.data;
  const readOnly = isReadOnly(note);
  const title = noteDisplayTitle(note);
  const exportMarkdown = () => {
    const snapshot = handleRef.current?.snapshot() ?? note;
    const heading =
      snapshot.title.trim() || (note.journal_date ? formatJournalDate(note.journal_date) : "");
    return `${heading ? `# ${heading}\n\n` : ""}${documentToMarkdown(snapshot.content)}`;
  };

  const moreItems: MenuItem[] = [
    {
      id: "export",
      label: "Export as Markdown",
      group: "Markdown",
      onSelect: () => download(exportFileName(title), exportMarkdown()),
    },
    {
      id: "copy",
      label: "Copy as Markdown",
      group: "Markdown",
      onSelect: () =>
        void navigator.clipboard.writeText(exportMarkdown()).then(
          () => onAnnounce("Copied the note as Markdown."),
          () => onAnnounce("Couldn’t copy to the clipboard."),
        ),
    },
    ...(note.trashed_at
      ? [
          { id: "restore", label: "Restore", onSelect: () => onAction(note, "restore") },
          {
            id: "delete",
            label: "Delete forever…",
            destructive: true,
            onSelect: () => onAction(note, "delete"),
          },
        ]
      : [
          ...(note.note_type === "journal"
            ? []
            : [{ id: "move", label: "Move to folder…", onSelect: () => onAction(note, "move") }]),
          { id: "duplicate", label: "Duplicate", onSelect: () => onAction(note, "duplicate") },
          {
            id: "archive",
            label: note.archived_at ? "Unarchive" : "Archive",
            onSelect: () => onAction(note, "archive"),
          },
          {
            id: "trash",
            label: "Move to Trash",
            destructive: true,
            onSelect: () => onAction(note, "trash"),
          },
        ]),
  ];

  return (
    <article aria-label={title} className="@container/pane">
      <div className="mb-4 flex items-center gap-1">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
          <ArrowLeft aria-hidden="true" /> Notes
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Show note list"
          aria-keyshortcuts="/"
          aria-haspopup="dialog"
          aria-expanded={listOpen}
          onClick={onShowList}
        >
          <PanelLeft aria-hidden="true" />
        </Button>
        <span className="flex-1 truncate text-xs text-muted-foreground">
          {note.journal_date ? formatJournalDate(note.journal_date) : null}
        </span>
        {note.trashed_at ? null : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={note.is_pinned ? "Unpin" : "Pin to top"}
              aria-pressed={note.is_pinned}
              onClick={() => onAction(note, "pin")}
            >
              <Pin className={cn(note.is_pinned && "fill-current text-brand")} aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={note.is_favorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={note.is_favorite}
              onClick={() => onAction(note, "favorite")}
            >
              <Star
                className={cn(note.is_favorite && "fill-current text-warning")}
                aria-hidden="true"
              />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={showDetails ? "Hide details" : "Show details"}
          aria-pressed={showDetails}
          onClick={() => {
            const next = !showDetails;
            setShowDetails(next);
            window.localStorage.setItem(DETAILS_KEY, next ? "shown" : "hidden");
          }}
        >
          <PanelRight aria-hidden="true" />
        </Button>
        <Menu
          aria-label="More note actions"
          variant="ghost"
          size="icon"
          chevron={false}
          align="end"
          className="size-8"
          items={moreItems}
        >
          <MoreHorizontal aria-hidden="true" />
        </Menu>
      </div>

      {readOnly ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2 text-sm">
          <span>
            {note.trashed_at ? "This note is in the Trash." : "This note is archived."} It can’t be
            edited.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction(note, note.trashed_at ? "restore" : "archive")}
          >
            {note.trashed_at ? "Restore" : "Unarchive"}
          </Button>
        </div>
      ) : null}

      <div
        className={cn(
          "@container/editor grid gap-8",
          showDetails &&
            "@3xl/pane:grid-cols-[minmax(0,1fr)_16rem] @6xl/pane:grid-cols-[minmax(0,1fr)_18rem]",
        )}
      >
        <div className="mx-auto w-full max-w-4xl min-w-0">
          <NoteEditor
            // A fresh editor when the note's state changes between editable and read-only.
            key={`${note.id}-${readOnly ? "read" : "edit"}`}
            workspaceId={workspaceId}
            note={note}
            readOnly={readOnly}
            handleRef={handleRef}
            onOpenNote={onOpenNote}
          />
        </div>
        {showDetails ? (
          <aside
            aria-label="Details"
            className="min-w-0 border-t pt-6 @3xl/pane:border-t-0 @3xl/pane:border-l @3xl/pane:pt-0 @3xl/pane:pl-6"
          >
            <NoteDetails
              workspaceId={workspaceId}
              note={note}
              folders={folders}
              tags={tags}
              readOnly={readOnly}
              onOpenNote={onOpenNote}
            />
          </aside>
        ) : null}
      </div>
    </article>
  );
}
