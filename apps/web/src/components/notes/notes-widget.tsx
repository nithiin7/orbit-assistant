"use client";

import type { NoteListQuery } from "@orbit/contracts";
import { BookOpen, NotebookPen, Pin, Star, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  WidgetBody,
  WidgetCard,
  WidgetEmpty,
  WidgetTabs,
} from "@/components/dashboard/widget-card";
import { Button } from "@/components/ui/button";
import { useActiveWorkspaceId, useViewerTimeZone } from "@/hooks/use-calendar";
import { useNoteList, useNoteMutations } from "@/hooks/use-notes";
import { journalToday, noteDisplayTitle, notesHref } from "@/lib/notes";
import { formatCalendarDate } from "@/utils/dates";

import { useQuickCapture } from "./quick-capture";

type Shelf = "recent" | "pinned" | "favorites";

const SHOWN = 5;

const QUERIES: Record<Shelf, NoteListQuery> = {
  recent: { sort: "updated_at", limit: SHOWN },
  pinned: { pinned: true, sort: "updated_at", limit: SHOWN },
  favorites: { favorite: true, sort: "updated_at", limit: SHOWN },
};

const EMPTY: Record<Shelf, string> = {
  recent: "No notes yet.",
  pinned: "No pinned notes. Pin a note to keep it here.",
  favorites: "No favorite notes yet.",
};

/**
 * Recently edited, pinned, and favorite notes, today's journal, and quick capture, for the
 * dashboard. Everything opens the note in Notes; nothing is copied.
 */
export function NotesWidget() {
  const workspaceId = useActiveWorkspaceId();
  const timeZone = useViewerTimeZone();
  const router = useRouter();
  const quickCapture = useQuickCapture();
  const [shelf, setShelf] = useState<Shelf>("recent");
  const notes = useNoteList(workspaceId, QUERIES[shelf]);
  const today = journalToday(timeZone);
  const journal = useNoteList(workspaceId, { type: ["journal"], sort: "journal_date", limit: 1 });
  const { openJournal } = useNoteMutations(workspaceId ?? "");
  const wroteToday =
    journal.state.status === "success" && journal.state.data.notes[0]?.journal_date === today;

  const openToday = () =>
    void openJournal.mutateAsync(today).then(
      (entry) => router.push(notesHref({ view: "journal", noteId: entry.id })),
      () => router.push(notesHref({ view: "journal" })),
    );

  return (
    <WidgetCard
      title="Notes"
      icon={NotebookPen}
      href={notesHref({})}
      linkLabel="Open notes"
      busy={notes.state.status === "loading"}
      actions={
        <Button variant="soft" size="sm" onClick={quickCapture.open}>
          <Zap aria-hidden="true" />
          Quick note
        </Button>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <WidgetTabs
          label="Show notes"
          options={[
            { value: "recent", label: "Recent" },
            { value: "pinned", label: "Pinned" },
            { value: "favorites", label: "Favorites" },
          ]}
          value={shelf}
          onChange={setShelf}
        />
        <Button variant="ghost" size="sm" disabled={openJournal.isPending} onClick={openToday}>
          <BookOpen aria-hidden="true" />
          {wroteToday ? "Today’s journal" : "Write today’s journal"}
        </Button>
      </div>
      <WidgetBody resource={notes.state} reload={notes.reload} label="notes">
        {(data) =>
          data.notes.length === 0 ? (
            <WidgetEmpty>{EMPTY[shelf]}</WidgetEmpty>
          ) : (
            <ul className="space-y-1 p-5 pt-3">
              {data.notes.map((note) => (
                <li key={note.id}>
                  <Link
                    href={notesHref({ noteId: note.id })}
                    className="flex items-start gap-2 rounded-md px-2 py-1.5 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <span className="truncate">{noteDisplayTitle(note)}</span>
                        {note.is_pinned ? (
                          <Pin
                            className="size-3 shrink-0 text-muted-foreground"
                            aria-label="Pinned"
                          />
                        ) : null}
                        {note.is_favorite ? (
                          <Star className="size-3 shrink-0 text-warning" aria-label="Favorite" />
                        ) : null}
                      </span>
                      {note.excerpt ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {note.excerpt}
                        </span>
                      ) : null}
                    </span>
                    <time
                      dateTime={note.updated_at}
                      className="shrink-0 pt-0.5 text-xs text-muted-foreground"
                    >
                      {formatCalendarDate(note.updated_at.slice(0, 10), {
                        omitYearIn: Number(today.slice(0, 4)),
                      })}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </WidgetBody>
    </WidgetCard>
  );
}
