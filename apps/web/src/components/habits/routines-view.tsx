"use client";

import type {
  Routine,
  RoutineList,
  RoutineSession,
  RoutineSessionList,
  RoutineStepStatus,
} from "@orbit/contracts";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  Clock,
  ListChecks,
  MoreHorizontal,
  NotebookPen,
  Pause,
  Pencil,
  Play,
  SkipForward,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { Resource } from "@/hooks/query-resource";
import { describeWeekdays, formatMinutes, habitsHref, routineMinutes } from "@/lib/habits";
import { noteHref } from "@/lib/note-content";
import { cn } from "@/utils/common";
import { formatCalendarDate } from "@/utils/dates";

import { HabitTile, ProgressBar } from "./habit-icon";
import { ViewError } from "./view-error";

function schedule(routine: Routine): string {
  return [
    describeWeekdays(routine.weekdays),
    routine.time_of_day?.slice(0, 5),
    routineMinutes(routine),
  ]
    .filter(Boolean)
    .join(" · ");
}

// List

export function RoutineListView({
  state,
  onReload,
  onCreate,
  onStart,
}: {
  state: Resource<RoutineList>;
  onReload: () => void;
  onCreate: () => void;
  onStart: (routine: Routine) => void;
}) {
  if (state.status === "loading") {
    return (
      <div className="grid gap-3 @2xl:grid-cols-2" aria-busy="true" aria-label="Loading routines">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }
  if (state.status === "error") return <ViewError message={state.message} onRetry={onReload} />;
  if (state.data.routines.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No routines yet"
        description="A routine is a short sequence you run through, like a morning or study routine. Steps can complete your habits as you go."
      >
        <Button onClick={onCreate}>New routine</Button>
      </EmptyState>
    );
  }
  return (
    <ul className="grid gap-3 @2xl:grid-cols-2 @6xl:grid-cols-3">
      {state.data.routines.map((routine) => (
        <li key={routine.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-start gap-3">
            <HabitTile icon={routine.icon} color={routine.color} />
            <div className="min-w-0 flex-1">
              <Link
                href={habitsHref({ kind: "routine", id: routine.id })}
                className="block truncate font-medium hover:underline"
              >
                {routine.name}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{schedule(routine)}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {routine.steps.length} step{routine.steps.length === 1 ? "" : "s"} ·{" "}
            {routine.sessions_completed} completed
            {routine.last_session ? ` · last ${formatCalendarDate(routine.last_session.day)}` : ""}
          </p>
          <div className="mt-auto">
            {routine.active_session ? (
              <Link
                href={habitsHref({ kind: "routine", id: routine.id })}
                className={buttonVariants({ variant: "soft", size: "sm" })}
              >
                Continue
              </Link>
            ) : routine.status === "active" ? (
              <Button
                size="sm"
                variant="soft"
                aria-label={`Start ${routine.name}`}
                onClick={() => onStart(routine)}
              >
                <Play aria-hidden="true" />
                Start
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                {routine.status === "paused" ? "Paused" : "Archived"}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// Detail

type RoutineDetailProps = {
  state: Resource<Routine>;
  sessions: Resource<RoutineSessionList>;
  onReload: () => void;
  onEdit: () => void;
  onStatus: (status: "active" | "paused" | "archived") => void;
  onDelete: () => void;
  onStart: () => Promise<unknown>;
  onStep: (session: RoutineSession, stepId: string, status: RoutineStepStatus) => Promise<unknown>;
  onFinish: (
    session: RoutineSession,
    status: "completed" | "abandoned",
    notes: string,
  ) => Promise<unknown>;
  onNote: (session: RoutineSession) => Promise<{ id: string }>;
  onOpenNote: (noteId: string) => void;
};

export function RoutineDetailView(props: RoutineDetailProps) {
  const { state, onReload } = props;
  if (state.status === "loading") {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading the routine">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (state.status === "error") return <ViewError message={state.message} onRetry={onReload} />;
  return <RoutineDetail {...props} routine={state.data} />;
}

function RoutineDetail({
  routine,
  sessions,
  onEdit,
  onStatus,
  onDelete,
  onStart,
  onStep,
  onFinish,
  onNote,
  onOpenNote,
}: RoutineDetailProps & { routine: Routine }) {
  const session = routine.active_session;
  return (
    <div className="space-y-6">
      <Link
        href={habitsHref({ kind: "view", view: "routines" })}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Routines
      </Link>
      <header className="flex flex-wrap items-start gap-4">
        <HabitTile icon={routine.icon} color={routine.color} className="size-12 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{routine.name}</h2>
          <p className="text-sm text-muted-foreground">{schedule(routine)}</p>
          {routine.description ? (
            <p className="max-w-prose text-sm whitespace-pre-line">{routine.description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {!session && routine.status === "active" ? (
            <Button onClick={() => void onStart()}>
              <Play aria-hidden="true" />
              Start
            </Button>
          ) : null}
          <Button variant="outline" onClick={onEdit}>
            <Pencil aria-hidden="true" />
            Edit
          </Button>
          <Menu
            variant="ghost"
            size="icon"
            chevron={false}
            align="end"
            aria-label="More actions"
            items={[
              routine.status === "active"
                ? { id: "pause", label: "Pause", icon: Pause, onSelect: () => onStatus("paused") }
                : {
                    id: "resume",
                    label: routine.status === "archived" ? "Restore" : "Resume",
                    icon: routine.status === "archived" ? ArchiveRestore : Play,
                    onSelect: () => onStatus("active"),
                  },
              ...(routine.status !== "archived"
                ? [
                    {
                      id: "archive",
                      label: "Archive",
                      icon: Archive,
                      onSelect: () => onStatus("archived"),
                    },
                  ]
                : []),
              {
                id: "delete",
                label: "Delete",
                icon: Trash2,
                destructive: true,
                onSelect: onDelete,
              },
            ]}
          >
            <MoreHorizontal aria-hidden="true" />
          </Menu>
        </div>
      </header>

      <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {session ? (
            <SessionRunner
              session={session}
              onStep={onStep}
              onFinish={onFinish}
              onNote={onNote}
              onOpenNote={onOpenNote}
            />
          ) : (
            <section aria-labelledby="steps-heading" className="rounded-xl border bg-card p-4">
              <h3 id="steps-heading" className="text-sm font-semibold">
                Steps
              </h3>
              {routine.steps.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No steps yet. Add some from Edit.
                </p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {routine.steps.map((step, index) => (
                    <li key={step.id} className="flex items-baseline gap-3 text-sm">
                      <span className="w-5 text-right text-muted-foreground tabular-nums">
                        {index + 1}
                      </span>
                      <span className="flex-1">{step.name}</span>
                      {step.duration_minutes ? (
                        <span className="text-xs text-muted-foreground">
                          {formatMinutes(step.duration_minutes)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>
        <aside className="space-y-6">
          <section aria-labelledby="history-heading" className="rounded-xl border bg-card p-4">
            <h3 id="history-heading" className="text-sm font-semibold">
              Past sessions
            </h3>
            <SessionHistory sessions={sessions} />
          </section>
        </aside>
      </div>
    </div>
  );
}

function SessionRunner({
  session,
  onStep,
  onFinish,
  onNote,
  onOpenNote,
}: {
  session: RoutineSession;
  onStep: RoutineDetailProps["onStep"];
  onFinish: RoutineDetailProps["onFinish"];
  onNote: RoutineDetailProps["onNote"];
  onOpenNote: RoutineDetailProps["onOpenNote"];
}) {
  const [notes, setNotes] = useState(session.notes);
  const [error, setError] = useState<string | null>(null);
  const done = session.steps.filter((step) => step.status !== "pending").length;
  const total = session.steps.length;

  async function attempt(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch {
      setError("Couldn’t save that. Try again.");
    }
  }

  return (
    <section aria-labelledby="session-heading" className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="session-heading" className="text-sm font-semibold">
          In progress · {formatCalendarDate(session.day)}
        </h3>
        <span className="text-sm text-muted-foreground tabular-nums">
          {done} of {total}
        </span>
      </div>
      <ProgressBar value={total ? done / total : 0} color="green" label="Session progress" />
      <ol className="space-y-2">
        {session.steps.map((step) => (
          <li
            key={step.id}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2",
              step.status === "completed" && "bg-success/5",
            )}
          >
            <button
              type="button"
              aria-pressed={step.status === "completed"}
              aria-label={
                step.status === "completed" ? `Undo ${step.name}` : `Complete ${step.name}`
              }
              onClick={() =>
                void attempt(() =>
                  onStep(session, step.id, step.status === "completed" ? "pending" : "completed"),
                )
              }
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                step.status === "completed"
                  ? "border-transparent bg-success text-white"
                  : "border-input hover:border-brand/60",
              )}
            >
              <Check
                className={cn(
                  "size-3.5",
                  step.status === "completed" ? "opacity-100" : "opacity-0",
                )}
                strokeWidth={3}
                aria-hidden="true"
              />
            </button>
            <span
              className={cn(
                "min-w-0 flex-1 text-sm",
                step.status === "skipped" && "text-muted-foreground line-through",
              )}
            >
              {step.name}
            </span>
            {step.duration_minutes ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" aria-hidden="true" />
                {formatMinutes(step.duration_minutes)}
              </span>
            ) : null}
            {step.status === "pending" ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Skip ${step.name}`}
                onClick={() => void attempt(() => onStep(session, step.id, "skipped"))}
              >
                <SkipForward aria-hidden="true" />
              </Button>
            ) : step.status === "skipped" ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Bring back ${step.name}`}
                onClick={() => void attempt(() => onStep(session, step.id, "pending"))}
              >
                <Undo2 aria-hidden="true" />
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="space-y-1.5">
        <label htmlFor="session-notes" className="block text-sm font-medium">
          How did it go? <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id="session-notes"
          rows={2}
          maxLength={5000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void attempt(() => onFinish(session, "completed", notes))}>
          Finish
        </Button>
        {session.note_id ? (
          <Link href={noteHref(session.note_id)} className={buttonVariants({ variant: "soft" })}>
            <NotebookPen aria-hidden="true" />
            Open note
          </Link>
        ) : (
          <Button
            variant="soft"
            onClick={() => void attempt(() => onNote(session).then((note) => onOpenNote(note.id)))}
          >
            <NotebookPen aria-hidden="true" />
            Write a note
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => void attempt(() => onFinish(session, "abandoned", notes))}
        >
          Stop for today
        </Button>
      </div>
    </section>
  );
}

function SessionHistory({ sessions }: { sessions: Resource<RoutineSessionList> }) {
  if (sessions.status === "loading") return <Skeleton className="mt-3 h-20 w-full" />;
  if (sessions.status === "error")
    return <p className="mt-2 text-sm text-muted-foreground">{sessions.message}</p>;
  const finished = sessions.data.sessions.filter((session) => session.status !== "active");
  if (finished.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">Sessions you finish appear here.</p>;
  }
  return (
    <ul className="mt-3 space-y-3">
      {finished.map((session) => {
        const done = session.steps.filter((step) => step.status === "completed").length;
        return (
          <li key={session.id} className="space-y-0.5 text-sm">
            <div className="flex justify-between gap-2">
              <span className="font-medium">{formatCalendarDate(session.day)}</span>
              <span className="text-muted-foreground">
                {session.status === "completed" ? "Finished" : "Stopped"} · {done}/
                {session.steps.length}
              </span>
            </div>
            {session.notes ? (
              <p className="text-xs text-muted-foreground">{session.notes}</p>
            ) : null}
            {session.note_id ? (
              <Link href={noteHref(session.note_id)} className="text-xs text-brand hover:underline">
                Session note
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
