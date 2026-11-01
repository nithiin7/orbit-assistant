"use client";

import type { CalendarCategory, CalendarOccurrence, Task } from "@orbit/contracts";
import {
  Bell,
  CalendarClock,
  CalendarX2,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  ListTodo,
  MapPin,
  NotebookPen,
  Pencil,
  Repeat,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCalendarEvent } from "@/hooks/use-calendar";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { useNoteList } from "@/hooks/use-notes";
import {
  type CalendarItem,
  CATEGORY_STYLES,
  describeAlert,
  describeRule,
  describeWhen,
} from "@/lib/calendar";
import { noteDisplayTitle, notesHref } from "@/lib/notes";
import { cn } from "@/utils/common";
import { formatCalendarDate } from "@/utils/dates";

export type EventActions = {
  edit: (occurrence: CalendarOccurrence) => void;
  duplicate: (occurrence: CalendarOccurrence) => Promise<void>;
  remove: (occurrence: CalendarOccurrence) => Promise<boolean>;
  /** Cancel or restore the occurrence (asking for a scope when it repeats). */
  setCancelled: (occurrence: CalendarOccurrence, cancelled: boolean) => Promise<void>;
  createNote: (occurrence: CalendarOccurrence) => Promise<string>;
  linkNote: (occurrence: CalendarOccurrence, noteId: string, linked: boolean) => Promise<void>;
  linkTask: (occurrence: CalendarOccurrence, taskId: string, linked: boolean) => Promise<void>;
};

export type TaskActions = {
  reschedule: (task: Task) => void;
  unschedule: (task: Task) => Promise<void>;
};

type ItemDetailsProps = {
  item: CalendarItem;
  workspaceId: string;
  timeZone: string;
  categories: ReadonlyMap<string, CalendarCategory>;
  openTasks: readonly Task[];
  events: EventActions;
  tasks: TaskActions;
  onClose: () => void;
};

/** An event occurrence's or a task's details and actions, in a modal `<dialog>`. */
export function ItemDetails(props: ItemDetailsProps) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { close, dialogProps } = useModalDialog({ onClose: props.onClose, dismissible: !busy });

  async function run(action: () => Promise<unknown>, fallback: string, closeAfter = false) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (closeAfter && result !== false) close();
    } catch (reason) {
      setError(describeApiError(reason, fallback));
    } finally {
      setBusy(false);
    }
  }

  const { item } = props;
  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-title`}
      className="dialog-motion dialog-pop mx-auto mt-[8vh] max-h-[84vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {item.kind === "task" ? (item.due ? "Task due" : "Scheduled task") : "Event"}
            </p>
            <h2
              id={`${id}-title`}
              className={cn(
                "text-lg leading-snug font-semibold text-pretty",
                ((item.kind === "event" && item.occurrence.status === "cancelled") ||
                  (item.kind === "task" && item.task.status === "completed")) &&
                  "text-muted-foreground line-through",
              )}
            >
              {item.kind === "event" ? item.occurrence.title : item.task.title}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mt-1.5 -mr-1.5 size-8 shrink-0"
            aria-label="Close"
            onClick={close}
          >
            <X aria-hidden="true" />
          </Button>
        </div>

        {item.kind === "event" ? (
          <EventBody {...props} occurrence={item.occurrence} busy={busy} run={run} />
        ) : (
          <TaskBody
            {...props}
            task={item.task}
            due={item.due}
            busy={busy}
            run={run}
            close={close}
          />
        )}

        <FormAlert message={error} />
      </div>
    </dialog>
  );
}

type Runner = (
  action: () => Promise<unknown>,
  fallback: string,
  closeAfter?: boolean,
) => Promise<void>;

function Row({ icon: Icon, children }: { icon: typeof Bell; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function EventBody({
  item,
  occurrence,
  workspaceId,
  timeZone,
  categories,
  openTasks,
  events,
  busy,
  run,
}: ItemDetailsProps & { occurrence: CalendarOccurrence; busy: boolean; run: Runner }) {
  const { state } = useCalendarEvent(workspaceId, occurrence.event_id);
  const recent = useNoteList(workspaceId, { sort: "recent", limit: 20 });
  const [noteToLink, setNoteToLink] = useState("");
  const [taskToLink, setTaskToLink] = useState("");
  const category = occurrence.category_id ? categories.get(occurrence.category_id) : undefined;
  const event = state.status === "success" ? state.data : null;
  const cancelled = occurrence.status === "cancelled";
  const linkedNoteIds = new Set(event?.notes.map((note) => note.id));
  const linkedTaskIds = new Set(event?.tasks.map((task) => task.id));
  const notes =
    recent.state.status === "success"
      ? recent.state.data.notes.filter((note) => !linkedNoteIds.has(note.id))
      : [];
  const tasks = openTasks.filter((task) => !linkedTaskIds.has(task.id));

  return (
    <>
      <div className="space-y-3">
        <Row icon={CalendarClock}>
          <p>{formatCalendarDate(occurrence.start.slice(0, 10))}</p>
          <p className="text-muted-foreground">{describeWhen(item, timeZone)}</p>
          {occurrence.timezone !== timeZone && !occurrence.all_day ? (
            <p className="text-xs text-muted-foreground">Event time zone: {occurrence.timezone}</p>
          ) : null}
        </Row>
        {event?.recurrence ? (
          <Row icon={Repeat}>
            <p>{describeRule(event.recurrence, event.start.slice(0, 10))}</p>
            {occurrence.modified ? (
              <p className="text-xs text-muted-foreground">This occurrence was changed.</p>
            ) : null}
          </Row>
        ) : null}
        {category ? (
          <Row icon={FileText}>
            <span className="flex items-center gap-2">
              <span
                className={cn("size-2.5 rounded-full", CATEGORY_STYLES[category.color].dot)}
                aria-hidden="true"
              />
              {category.name}
            </span>
          </Row>
        ) : null}
        {occurrence.location ? (
          <Row icon={MapPin}>
            <p className="break-words">{occurrence.location}</p>
          </Row>
        ) : null}
        {occurrence.description ? (
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {occurrence.description}
          </p>
        ) : null}
        {event && event.alerts.length > 0 ? (
          <Row icon={Bell}>
            <p>{event.alerts.map(describeAlert).join(", ")}</p>
          </Row>
        ) : null}
        {cancelled ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            This occurrence is cancelled. Its reminders won’t notify.
          </p>
        ) : null}
      </div>

      <section aria-labelledby="event-notes" className="space-y-2 border-t pt-4">
        <h3 id="event-notes" className="flex items-center gap-2 text-sm font-semibold">
          <NotebookPen className="size-4 text-muted-foreground" aria-hidden="true" />
          Notes
        </h3>
        {state.status === "loading" ? (
          <Skeleton className="h-4 w-1/2" />
        ) : event && event.notes.length > 0 ? (
          <ul className="space-y-1">
            {event.notes.map((note) => (
              <li key={note.id} className="flex items-center gap-2 text-sm">
                <Link
                  href={notesHref({ noteId: note.id })}
                  className="min-w-0 flex-1 truncate rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {note.title || "Untitled"}
                  {note.trashed ? <span className="text-muted-foreground"> (in trash)</span> : null}
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={busy}
                  aria-label={`Unlink note ${note.title || "Untitled"}`}
                  onClick={() =>
                    void run(
                      () => events.linkNote(occurrence, note.id, false),
                      "Couldn’t unlink the note.",
                    )
                  }
                >
                  Unlink
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="soft"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(() => events.createNote(occurrence), "Couldn’t create the note.")
            }
          >
            <NotebookPen aria-hidden="true" />
            {category?.name === "Meeting" ? "Create meeting notes" : "Create notes"}
          </Button>
          {notes.length > 0 ? (
            <div className="flex items-center gap-1">
              <Select
                aria-label="Link an existing note"
                value={noteToLink}
                onValueChange={setNoteToLink}
                placeholder="Link a note…"
                className="h-8 w-44 text-xs"
                options={notes.map((note) => ({ value: note.id, label: noteDisplayTitle(note) }))}
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || !noteToLink}
                onClick={() =>
                  void run(async () => {
                    await events.linkNote(occurrence, noteToLink, true);
                    setNoteToLink("");
                  }, "Couldn’t link the note.")
                }
              >
                Link
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="event-tasks" className="space-y-2 border-t pt-4">
        <h3 id="event-tasks" className="flex items-center gap-2 text-sm font-semibold">
          <ListTodo className="size-4 text-muted-foreground" aria-hidden="true" />
          Tasks
        </h3>
        {event && event.tasks.length > 0 ? (
          <ul className="space-y-1">
            {event.tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-2 text-sm">
                {task.status === "completed" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Completed" />
                ) : null}
                <Link
                  href={`/tasks?task=${task.id}`}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
                    task.status === "completed" && "text-muted-foreground line-through",
                  )}
                >
                  {task.title}
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={busy}
                  aria-label={`Unlink task ${task.title}`}
                  onClick={() =>
                    void run(
                      () => events.linkTask(occurrence, task.id, false),
                      "Couldn’t unlink the task.",
                    )
                  }
                >
                  Unlink
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No linked tasks.</p>
        )}
        {tasks.length > 0 ? (
          <div className="flex items-center gap-1">
            <Select
              aria-label="Link a task"
              value={taskToLink}
              onValueChange={setTaskToLink}
              placeholder="Link a task…"
              className="h-8 w-56 text-xs"
              options={tasks.map((task) => ({ value: task.id, label: task.title }))}
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || !taskToLink}
              onClick={() =>
                void run(async () => {
                  await events.linkTask(occurrence, taskToLink, true);
                  setTaskToLink("");
                }, "Couldn’t link the task.")
              }
            >
              Link
            </Button>
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button disabled={busy} onClick={() => events.edit(occurrence)}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(() => events.duplicate(occurrence), "Couldn’t duplicate the event.", true)
          }
        >
          <Copy aria-hidden="true" />
          Duplicate
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(
              () => events.setCancelled(occurrence, !cancelled),
              cancelled ? "Couldn’t restore the event." : "Couldn’t cancel the event.",
              true,
            )
          }
        >
          {cancelled ? <RotateCcw aria-hidden="true" /> : <CalendarX2 aria-hidden="true" />}
          {cancelled ? "Restore" : "Cancel event"}
        </Button>
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() =>
            void run(() => events.remove(occurrence), "Couldn’t delete the event.", true)
          }
        >
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      </div>
    </>
  );
}

function TaskBody({
  item,
  task,
  due,
  timeZone,
  tasks,
  busy,
  run,
  close,
}: ItemDetailsProps & { task: Task; due: boolean; busy: boolean; run: Runner; close: () => void }) {
  return (
    <>
      <div className="space-y-3">
        <Row icon={CalendarClock}>
          {due ? (
            <p>Due {formatCalendarDate(task.due_date ?? "")}</p>
          ) : (
            <p>{describeWhen(item, timeZone)}</p>
          )}
          {!due && task.due_date ? (
            <p className="text-muted-foreground">Due {formatCalendarDate(task.due_date)}</p>
          ) : null}
        </Row>
        <Row icon={CheckCircle2}>
          <p>{task.status === "completed" ? "Completed" : "Open"}</p>
        </Row>
        {task.description ? (
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{task.description}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Link href={`/tasks?task=${task.id}`} className={buttonVariants()}>
          <ExternalLink aria-hidden="true" />
          Open task
        </Link>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            close();
            tasks.reschedule(task);
          }}
        >
          <CalendarClock aria-hidden="true" />
          {due ? "Schedule a time" : "Reschedule"}
        </Button>
        {due ? null : (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(() => tasks.unschedule(task), "Couldn’t unschedule the task.", true)
            }
          >
            Unschedule
          </Button>
        )}
      </div>
    </>
  );
}
