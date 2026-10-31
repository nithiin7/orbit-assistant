"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import { useTaskNotes } from "@/hooks/use-notes";
import { noteDisplayTitle, notesHref } from "@/lib/notes";

/** The notes linked to a task, shown in the task's dialog. Links are made from the note. */
export function TaskNotes({ taskId }: { taskId: string }) {
  const headingId = useId();
  const { state } = useTaskNotes(taskId);
  if (state.status !== "success" || state.data.notes.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="space-y-1.5">
      <h3 id={headingId} className="text-sm font-medium">
        Notes
      </h3>
      <ul className="space-y-0.5">
        {state.data.notes.map((note) => (
          <li key={note.id}>
            <Link
              href={notesHref({ noteId: note.id })}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{noteDisplayTitle(note)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
