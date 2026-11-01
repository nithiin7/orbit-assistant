"use client";

import type { HabitDetail, HabitHistory, LogHabitRequest } from "@orbit/contracts";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bell,
  CheckSquare,
  MoreHorizontal,
  NotebookPen,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { describeApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { Resource } from "@/hooks/query-resource";
import {
  describeProgress,
  describeSchedule,
  describeStreak,
  describeTarget,
  describeWeekdays,
  formatRate,
  habitsHref,
  STATE_LABELS,
} from "@/lib/habits";
import { noteHref } from "@/lib/note-content";
import { cn } from "@/utils/common";
import { addDays, formatCalendarDate } from "@/utils/dates";

import { type HeatCell, Heatmap } from "./habit-heatmap";
import { HabitTile } from "./habit-icon";
import { HabitRow } from "./habit-row";
import { ViewError } from "./view-error";

/** How far back the detail page's heatmap reaches: about six months. */
export const HEATMAP_DAYS = 182;

type HabitDetailViewProps = {
  state: Resource<HabitDetail>;
  history: Resource<HabitHistory>;
  onReload: () => void;
  onEdit: () => void;
  onStatus: (status: "active" | "paused" | "archived") => Promise<unknown>;
  onDelete: () => void;
  onLog: (day: string, body: LogHabitRequest | null) => Promise<unknown>;
  onCreateTask: (title: string) => Promise<unknown>;
  onUnlinkTask: (taskId: string) => Promise<unknown>;
  onReflect: (day: string) => Promise<{ id: string }>;
  onUnlinkNote: (noteId: string) => Promise<unknown>;
  onOpenNote: (noteId: string) => void;
};

function heatCells(history: HabitHistory): HeatCell[] {
  return history.days.map((day) => {
    switch (day.state) {
      case "completed":
      case "bonus":
        return { day: day.day, level: 4, label: STATE_LABELS[day.state] };
      case "partial":
        return { day: day.day, level: 2, label: STATE_LABELS.partial };
      case "missed":
      case "pending":
        return { day: day.day, level: 0, label: STATE_LABELS[day.state] };
      case "open":
        return { day: day.day, level: 0, label: "Any day this week" };
      default:
        return { day: day.day, level: null, label: STATE_LABELS[day.state] };
    }
  });
}

export function HabitDetailView(props: HabitDetailViewProps) {
  const { state, history, onReload } = props;
  if (state.status === "loading") {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading the habit">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (state.status === "error") return <ViewError message={state.message} onRetry={onReload} />;
  return <Loaded {...props} detail={state.data} history={history} />;
}

function Loaded({
  detail,
  history,
  onEdit,
  onStatus,
  onDelete,
  onLog,
  onCreateTask,
  onUnlinkTask,
  onReflect,
  onUnlinkNote,
  onOpenNote,
}: HabitDetailViewProps & { detail: HabitDetail }) {
  const { habit } = detail;
  const target = describeTarget(habit);
  const today = detail.day;

  return (
    <div className="space-y-6">
      <Link
        href={habitsHref({ kind: "view", view: habit.status === "archived" ? "archived" : "all" })}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {habit.status === "archived" ? "Archived habits" : "All habits"}
      </Link>

      <header className="flex flex-wrap items-start gap-4">
        <HabitTile icon={habit.icon} color={habit.color} className="size-12 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{habit.name}</h2>
          <p className="text-sm text-muted-foreground">
            {[describeSchedule(habit.schedule), target, habit.time_of_day?.slice(0, 5)]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {habit.description ? (
            <p className="max-w-prose text-sm whitespace-pre-line">{habit.description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {habit.status !== "active" ? (
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {habit.status === "paused" ? "Paused" : "Archived"}
            </span>
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
              habit.status === "active"
                ? {
                    id: "pause",
                    label: "Pause",
                    description: "Paused days don’t count against you.",
                    icon: Pause,
                    onSelect: () => void onStatus("paused"),
                  }
                : {
                    id: "resume",
                    label: habit.status === "archived" ? "Restore" : "Resume",
                    icon: habit.status === "archived" ? ArchiveRestore : Play,
                    onSelect: () => void onStatus("active"),
                  },
              ...(habit.status !== "archived"
                ? [
                    {
                      id: "archive",
                      label: "Archive",
                      description: "Keeps the history; stops reminders.",
                      icon: Archive,
                      onSelect: () => void onStatus("archived"),
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
          {habit.status !== "archived" ? (
            <section aria-label="Today" className="@container/rows">
              <ul>
                <HabitRow item={detail} onLog={(body) => onLog(today, body)} />
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="stats-heading" className="space-y-3">
            <h3 id="stats-heading" className="text-sm font-semibold">
              Progress
            </h3>
            <dl className="grid grid-cols-2 gap-3 @xl:grid-cols-3">
              <Stat
                label="Current streak"
                value={describeStreak(detail.current_streak, detail.streak_unit)}
              />
              <Stat
                label="Longest streak"
                value={describeStreak(detail.longest_streak, detail.streak_unit)}
              />
              <Stat label="Total completions" value={String(detail.total_completions)} />
              <Stat label="Completion rate" value={formatRate(detail.completion_rate)} />
              <Stat label="Last 7 days" value={formatRate(detail.weekly_rate)} />
              <Stat label="Last 30 days" value={formatRate(detail.monthly_rate)} />
            </dl>
            <p className="text-xs text-muted-foreground">
              Rates count only days the habit was due. Skipped and paused days aren’t counted.
              {habit.schedule.type === "weekly_target"
                ? " Streaks count weeks that met the target."
                : null}
            </p>
          </section>

          <section
            aria-labelledby="heatmap-heading"
            className="space-y-3 rounded-xl border bg-card p-4"
          >
            <h3 id="heatmap-heading" className="text-sm font-semibold">
              The last six months
            </h3>
            {history.status === "success" ? (
              <Heatmap cells={heatCells(history.data)} label={`${habit.name}, by day`} />
            ) : history.status === "loading" ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <p className="text-sm text-muted-foreground">{history.message}</p>
            )}
          </section>

          <PastDay habit={detail} onLog={onLog} />

          {history.status === "success" ? (
            <RecentDays history={history.data} detail={detail} />
          ) : null}
        </div>

        <aside className="space-y-6">
          <Panel title="Reminders" icon={Bell}>
            {detail.reminders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reminders. Add one from Edit.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {detail.reminders.map((reminder) => (
                  <li key={reminder.id} className="flex justify-between gap-2">
                    <span className="tabular-nums">{reminder.time.slice(0, 5)}</span>
                    <span className="text-muted-foreground">
                      {reminder.weekdays?.length ? describeWeekdays(reminder.weekdays) : "Due days"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {habit.status !== "active" && detail.reminders.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Off while the habit isn’t active.
              </p>
            ) : null}
          </Panel>

          <TaskPanel detail={detail} onCreate={onCreateTask} onUnlink={onUnlinkTask} />

          <Panel title="Reflections" icon={NotebookPen}>
            {detail.notes.length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {detail.notes.map((note) => (
                  <li key={note.id} className="flex items-center gap-2">
                    <Link
                      href={noteHref(note.id)}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {note.title || "Untitled note"}
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Unlink ${note.title || "note"}`}
                      onClick={() => void onUnlinkNote(note.id)}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Notes about how it’s going. They’re ordinary notes, kept in your Inbox.
              </p>
            )}
            <Button
              variant="soft"
              size="sm"
              className="mt-3"
              onClick={() => void onReflect(today).then((note) => onOpenNote(note.id))}
            >
              <Plus aria-hidden="true" />
              Write a reflection
            </Button>
          </Panel>

          <Panel title="Schedule history">
            <ol className="space-y-1.5 text-sm">
              {habit.schedule_history.map((version) => (
                <li key={version.effective_from} className="flex justify-between gap-2">
                  <span>{describeSchedule(version.schedule)}</span>
                  <span className="text-muted-foreground">
                    from {formatCalendarDate(version.effective_from)}
                  </span>
                </li>
              ))}
            </ol>
            {habit.pauses.length > 0 ? (
              <>
                <h4 className="mt-3 text-xs font-medium text-muted-foreground">Paused</h4>
                <ul className="mt-1 space-y-1 text-sm">
                  {habit.pauses.map((pause) => (
                    <li key={pause.start}>
                      {formatCalendarDate(pause.start)} –{" "}
                      {pause.end ? formatCalendarDate(addDays(pause.end, -1)) : "now"}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: typeof Bell;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-xl border bg-card p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {Icon ? <Icon className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
        {title}
      </h3>
      {children}
    </section>
  );
}

function TaskPanel({
  detail,
  onCreate,
  onUnlink,
}: {
  detail: HabitDetail;
  onCreate: (title: string) => Promise<unknown>;
  onUnlink: (taskId: string) => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      await onCreate(title.trim());
      setTitle("");
      setError(null);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t add the task."));
    }
  }
  return (
    <Panel title="Related tasks" icon={CheckSquare}>
      {detail.tasks.length > 0 ? (
        <ul className="space-y-1.5 text-sm">
          {detail.tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2">
              <Link
                href={`/tasks?task=${task.id}`}
                className={cn(
                  "min-w-0 flex-1 truncate hover:underline",
                  task.status === "completed" && "text-muted-foreground line-through",
                )}
              >
                {task.title}
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Unlink ${task.title}`}
                onClick={() => void onUnlink(task.id)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          One-off tasks that support this habit, like buying running shoes.
        </p>
      )}
      <form onSubmit={(event) => void submit(event)} className="mt-3 flex gap-2">
        <label htmlFor="habit-task-title" className="sr-only">
          New related task
        </label>
        <Input
          id="habit-task-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task"
          maxLength={200}
          className="h-8"
        />
        <Button type="submit" size="sm" variant="soft" disabled={!title.trim()}>
          Add
        </Button>
      </form>
      {error ? <p className="mt-1.5 text-xs font-medium text-destructive">{error}</p> : null}
    </Panel>
  );
}

/** Record a day that's already passed: done, or skipped. */
function PastDay({
  habit,
  onLog,
}: {
  habit: HabitDetail;
  onLog: (day: string, body: LogHabitRequest | null) => Promise<unknown>;
}) {
  const [day, setDay] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  async function record(status: "completed" | "skipped") {
    if (!day) return;
    try {
      await onLog(day, { status, value: null, note: "" });
      setMessage({
        text: `${formatCalendarDate(day)} marked ${status === "completed" ? "done" : "skipped"}.`,
        error: false,
      });
    } catch (reason) {
      setMessage({ text: describeApiError(reason, "Couldn’t record that day."), error: true });
    }
  }
  if (habit.habit.status === "archived") return null;
  return (
    <section aria-labelledby="past-heading" className="space-y-2">
      <h3 id="past-heading" className="text-sm font-semibold">
        Record a past day
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <DatePicker
          value={day}
          onValueChange={setDay}
          aria-label="Day to record"
          className="w-48"
        />
        <Button size="sm" variant="soft" disabled={!day} onClick={() => void record("completed")}>
          Mark done
        </Button>
        <Button size="sm" variant="ghost" disabled={!day} onClick={() => void record("skipped")}>
          Skip
        </Button>
      </div>
      {message ? (
        <p
          role={message.error ? "alert" : "status"}
          className={cn(
            "text-xs",
            message.error ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}

function RecentDays({ history, detail }: { history: HabitHistory; detail: HabitDetail }) {
  const logged = [...history.days]
    .reverse()
    .filter((day) => day.log !== null)
    .slice(0, 14);
  if (logged.length === 0) return null;
  return (
    <section aria-labelledby="recent-heading" className="space-y-2">
      <h3 id="recent-heading" className="text-sm font-semibold">
        Recent entries
      </h3>
      <ul className="divide-y rounded-xl border bg-card">
        {logged.map((day) => (
          <li
            key={day.day}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm"
          >
            <span className="w-28 shrink-0 text-muted-foreground">
              {formatCalendarDate(day.day)}
            </span>
            <span className="font-medium">{STATE_LABELS[day.state]}</span>
            {day.log && detail.habit.kind !== "boolean" && day.log.status !== "skipped" ? (
              <span className="text-muted-foreground">
                {describeProgress({ ...detail.habit, target: day.log.target }, day.log.value)}
              </span>
            ) : null}
            {day.log?.note ? (
              <span className="w-full text-xs text-muted-foreground">{day.log.note}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
