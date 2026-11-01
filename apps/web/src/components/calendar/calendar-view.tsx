"use client";

import type {
  CalendarEditScope,
  CalendarOccurrence,
  CalendarView as ViewName,
  Task,
  UpdateOccurrenceRequest,
} from "@orbit/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";

import { calendarEventOptions } from "@/api/calendar";
import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCalendarCategories,
  useCalendarMutations,
  useCalendarPreferences,
  useCalendarRange,
  useUnscheduledTasks,
  useViewerTimeZone,
} from "@/hooks/use-calendar";
import { useTaskList } from "@/hooks/use-tasks";
import {
  CALENDAR_VIEWS,
  calendarHref,
  type CalendarItem,
  DEFAULT_TASK_MINUTES,
  type EventFormValues,
  eventItem,
  minutesOfTime,
  movedDates,
  movedTimes,
  movedToDate,
  newEventValues,
  occurrenceKey,
  parseCalendarLocation,
  rangeTitle,
  resolveWeekStart,
  shiftDate,
  taskItem,
  taskSchedule,
  taskScheduleValues,
  timeOfMinutes,
  todayIn,
  toEventFormValues,
  toEventRequest,
  visibleRange,
  weekDates,
} from "@/lib/calendar";
import { notesHref } from "@/lib/notes";
import { useAuth } from "@/providers/auth";
import { useWorkspaces } from "@/providers/workspace";
import { cn } from "@/utils/common";
import { daysBetween, firstDayOfWeek } from "@/utils/dates";
import { isEditableTarget } from "@/utils/keyboard";
import { localParts, zonedTimeToInstant } from "@/utils/time-zones";

import { AgendaView } from "./agenda-view";
import { CalendarSettingsDialog } from "./calendar-settings-dialog";
import { CalendarSidebar } from "./calendar-sidebar";
import { EventDialog, type EventDialogMode } from "./event-dialog";
import { type EventActions, ItemDetails, type TaskActions } from "./item-details";
import { MonthView } from "./month-view";
import { ScheduleTaskDialog } from "./schedule-task-dialog";
import { useScopePrompt } from "./scope-dialog";
import { TimeGrid } from "./time-grid";

/** The Calendar page for the active workspace. Remounts (and resets) when the workspace changes. */
export function CalendarPanel() {
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
  if (state.status === "loading") return <CalendarSkeleton />;
  return <CalendarView key={state.active.id} workspaceId={state.active.id} />;
}

function CalendarSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">Loading calendar…</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[60vh] w-full rounded-xl" />
    </div>
  );
}

type EditorState = {
  mode: EventDialogMode;
  initial: EventFormValues;
  /** For edits: the event, and for occurrence edits, the occurrence and scope. */
  eventId?: string;
  occurrence?: CalendarOccurrence;
  scope?: CalendarEditScope;
};

/** The occurrence's local times (in its own time zone) as form values. */
function occurrenceValues(occurrence: CalendarOccurrence, base: EventFormValues): EventFormValues {
  return {
    ...base,
    title: occurrence.title,
    description: occurrence.description,
    location: occurrence.location,
    categoryId: occurrence.category_id ?? "",
    startDate: occurrence.start.slice(0, 10),
    startTime: occurrence.start.slice(11, 16),
    endDate: occurrence.all_day ? occurrence.start.slice(0, 10) : occurrence.end.slice(0, 10),
    endTime: occurrence.end.slice(11, 16),
  };
}

/** An occurrence as it will look once moved to local `start`/`end` (in its time zone). */
function preview(occurrence: CalendarOccurrence, start: string, end: string): CalendarOccurrence {
  const instant = (local: string) =>
    zonedTimeToInstant(local.slice(0, 10), local.slice(11, 16), occurrence.timezone).toISOString();
  return {
    ...occurrence,
    start: `${start}:00`,
    end: `${end}:00`,
    start_at: instant(start),
    end_at: instant(end),
  };
}

function CalendarView({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { withToken } = useAuth();
  const timeZone = useViewerTimeZone();
  const { preferences, ready, save: savePreferences } = useCalendarPreferences();
  const { categories, byId: categoriesById } = useCalendarCategories(workspaceId);
  const mutations = useCalendarMutations(workspaceId);
  const { askScope, scopeDialog } = useScopePrompt();
  const { confirm, confirmDialog } = useConfirm();
  const today = todayIn(timeZone);
  const location = parseCalendarLocation(params, {
    view: preferences?.default_view ?? "month",
    date: today,
  });
  const { view, date } = location;
  const weekStart = resolveWeekStart(preferences?.week_start, firstDayOfWeek());
  const workingHours = {
    start: minutesOfTime(preferences?.working_hours_start ?? "09:00"),
    end: minutesOfTime(preferences?.working_hours_end ?? "17:00"),
  };
  const showUnscheduled = preferences?.show_unscheduled_tasks ?? true;
  const showDue = preferences?.show_due_tasks ?? true;

  const range = visibleRange(view, date, weekStart);
  const rangeQuery = {
    start: range.start,
    end: range.end,
    timezone: timeZone,
    include_completed_tasks: preferences?.show_completed_tasks ?? true,
  };
  // Wait for preferences, which decide the week's first day, so the range is fetched once.
  const { state, refreshing, reload } = useCalendarRange(
    view === "agenda" || !ready ? null : workspaceId,
    rangeQuery,
  );
  const unscheduled = useUnscheduledTasks(workspaceId, showUnscheduled);
  const openTasks = useTaskList(workspaceId, { status: "open", sort: "due_date", limit: 200 });
  const openTaskList = openTasks.state.status === "success" ? openTasks.state.data.tasks : [];

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [details, setDetails] = useState<CalendarItem | null>(null);
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // The React Compiler memoizes these; no manual `useMemo` or `useCallback` is needed.
  const items: CalendarItem[] =
    state.status === "success"
      ? [
          ...state.data.occurrences.map(eventItem),
          ...state.data.scheduled_tasks.map((task) => taskItem(task)),
          ...(showDue ? state.data.due_tasks.map((task) => taskItem(task, true)) : []),
        ]
      : [];

  const go = (next: { view?: ViewName; date?: string }) =>
    router.replace(calendarHref({ view: next.view ?? view, date: next.date ?? date }), {
      scroll: false,
    });

  const openCreate = (
    start: { date: string; minutes?: number; endMinutes?: number; allDay?: boolean } = { date },
  ) => setEditor({ mode: "create", initial: newEventValues(timeZone, start) });

  // `?new=1` (from the command palette) opens the new-event dialog once: state adjusted while
  // rendering, then the URL is cleaned up.
  const wantsNew = params.get("new") === "1";
  const [handledNew, setHandledNew] = useState(false);
  if (wantsNew && !handledNew) {
    setHandledNew(true);
    setEditor({
      mode: "create",
      initial: newEventValues(timeZone, { date, minutes: workingHours.start }),
    });
  } else if (!wantsNew && handledNew) {
    setHandledNew(false);
  }
  useEffect(() => {
    if (wantsNew) router.replace(calendarHref({ view, date }), { scroll: false });
  }, [wantsNew, router, view, date]);

  // Keyboard: N new event, T today, M/W/D/A views, ← → previous and next.
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
    if (document.querySelector("dialog[open]")) return;
    const key = event.key.toLowerCase();
    const views: Record<string, ViewName> = { m: "month", w: "week", d: "day", a: "agenda" };
    if (key === "n") openCreate();
    else if (key === "t") go({ date: today });
    else if (views[key]) go({ view: views[key] });
    else if (event.key === "ArrowLeft") go({ date: shiftDate(view, date, -1) });
    else if (event.key === "ArrowRight") go({ date: shiftDate(view, date, 1) });
    else return;
    event.preventDefault();
  });
  useEffect(() => {
    document.addEventListener("keydown", onShortcut);
    return () => document.removeEventListener("keydown", onShortcut);
  }, []);

  async function report(action: () => Promise<unknown>, fallback: string) {
    setActionError(null);
    try {
      await action();
    } catch (reason) {
      setActionError(describeApiError(reason, fallback));
    }
  }

  /** The scope for a change to a repeating occurrence, or `"this"` for a single event. */
  async function scopeFor(occurrence: CalendarOccurrence, action: "change" | "delete") {
    return occurrence.recurring ? askScope(action) : ("this" as const);
  }

  async function moveOccurrence(occurrence: CalendarOccurrence, start: string, end: string) {
    const scope = await scopeFor(occurrence, "change");
    if (!scope) return;
    await report(
      () =>
        mutations.updateOne.mutateAsync({
          occurrence,
          body: { scope, start, end },
          preview: scope === "this" ? preview(occurrence, start, end) : undefined,
        }),
      "Couldn’t move the event.",
    );
  }

  function moveTask(task: Task, start: Date, lengthMinutes: number) {
    void report(
      () =>
        mutations.scheduleTask.mutateAsync({
          task,
          schedule: {
            scheduled_start: start.toISOString(),
            scheduled_end: new Date(start.getTime() + lengthMinutes * 60_000).toISOString(),
          },
        }),
      "Couldn’t move the task.",
    );
  }

  function taskLength(task: Task): number {
    if (!task.scheduled_start || !task.scheduled_end) return DEFAULT_TASK_MINUTES;
    return Math.round((Date.parse(task.scheduled_end) - Date.parse(task.scheduled_start)) / 60_000);
  }

  function findTask(taskId: string): Task | undefined {
    const pools = [
      unscheduled.status === "success" ? unscheduled.data.tasks : [],
      openTaskList,
      state.status === "success" ? state.data.due_tasks : [],
    ];
    return pools.flat().find((task) => task.id === taskId);
  }

  const onMoveTimed = (item: CalendarItem, day: string, minutes: number, edge: "start" | "end") => {
    if (item.kind === "event") {
      const { start, end } = movedTimes(item.occurrence, { date: day, minutes, edge }, timeZone);
      void moveOccurrence(item.occurrence, start, end);
      return;
    }
    const { task } = item;
    const at = zonedTimeToInstant(day, timeOfMinutes(minutes), timeZone);
    if (edge === "start") {
      moveTask(task, at, taskLength(task));
    } else if (task.scheduled_start) {
      const start = new Date(task.scheduled_start);
      moveTask(task, start, Math.max(15, Math.round((at.getTime() - start.getTime()) / 60_000)));
    }
  };

  const onMoveToDate = (item: CalendarItem, day: string) => {
    if (item.kind === "event") {
      const moved = item.occurrence.all_day
        ? movedDates(item.occurrence, day)
        : movedToDate(item.occurrence, day);
      void moveOccurrence(item.occurrence, moved.start, moved.end);
      return;
    }
    const { task } = item;
    if (!task.scheduled_start) return;
    const from = localParts(new Date(task.scheduled_start), timeZone);
    const shift = daysBetween(from.date, day);
    if (shift === 0) return;
    moveTask(
      task,
      new Date(Date.parse(task.scheduled_start) + shift * 86_400_000),
      taskLength(task),
    );
  };

  const onDropTask = (taskId: string, day: string, minutes = workingHours.start) => {
    const task = findTask(taskId);
    if (!task) return;
    void report(
      () =>
        mutations.scheduleTask.mutateAsync({
          task,
          schedule: taskSchedule(day, minutes, DEFAULT_TASK_MINUTES, timeZone),
        }),
      "Couldn’t schedule the task.",
    );
  };

  async function loadEvent(eventId: string) {
    return queryClient.fetchQuery(calendarEventOptions(withToken, workspaceId, eventId));
  }

  const eventActions: EventActions = {
    edit: (occurrence) => {
      void (async () => {
        const scope = occurrence.recurring ? await askScope("change") : "series";
        if (!scope) return;
        try {
          const event = await loadEvent(occurrence.event_id);
          const base = toEventFormValues(event);
          setDetails(null);
          if (scope === "series") {
            setEditor({ mode: "series", initial: base, eventId: event.id });
          } else {
            setEditor({
              mode: "occurrence",
              initial: occurrenceValues(occurrence, base),
              eventId: event.id,
              occurrence,
              scope,
            });
          }
        } catch (reason) {
          setActionError(describeApiError(reason, "Couldn’t open the event."));
        }
      })();
    },
    duplicate: async (occurrence) => {
      await mutations.duplicate.mutateAsync(occurrence.event_id);
    },
    remove: async (occurrence) => {
      if (occurrence.recurring) {
        const scope = await askScope("delete");
        if (!scope) return false;
        await mutations.removeOne.mutateAsync({ occurrence, scope });
        return true;
      }
      const confirmed = await confirm({
        title: `Delete “${occurrence.title}”?`,
        description: "Its reminders are deleted too. Linked notes and tasks stay.",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!confirmed) return false;
      await mutations.remove.mutateAsync(occurrence.event_id);
      return true;
    },
    setCancelled: async (occurrence, cancelled) => {
      const scope = await scopeFor(occurrence, "change");
      if (!scope) return;
      await mutations.updateOne.mutateAsync({
        occurrence,
        body: { scope, status: cancelled ? "cancelled" : "confirmed" },
      });
    },
    createNote: async (occurrence) => {
      const note = await mutations.createNote.mutateAsync({
        eventId: occurrence.event_id,
        occurrenceStart: occurrenceKey(occurrence),
      });
      router.push(notesHref({ noteId: note.id }));
      return note.id;
    },
    linkNote: async (occurrence, noteId, linked) => {
      await mutations.linkNote.mutateAsync({ eventId: occurrence.event_id, noteId, linked });
    },
    linkTask: async (occurrence, taskId, linked) => {
      await mutations.linkTask.mutateAsync({ eventId: occurrence.event_id, taskId, linked });
    },
  };

  const taskActions: TaskActions = {
    reschedule: (task) => setScheduling(task),
    unschedule: async (task) => {
      await mutations.scheduleTask.mutateAsync({ task, schedule: null });
    },
  };

  async function saveEditor(values: EventFormValues, taskId: string | null) {
    if (!editor) return;
    const fields = toEventRequest(values);
    if (editor.mode === "create") {
      await mutations.create.mutateAsync({
        ...fields,
        status: "confirmed",
        task_ids: taskId ? [taskId] : [],
      });
      return;
    }
    if (editor.mode === "series" && editor.eventId) {
      await mutations.update.mutateAsync({ eventId: editor.eventId, body: fields });
      return;
    }
    const { occurrence, scope } = editor;
    if (!occurrence || !scope) return;
    // Only what changed, so the rest of the occurrence keeps following the series.
    const before = toEventRequest(editor.initial);
    const body: UpdateOccurrenceRequest = { scope };
    if (fields.title !== before.title) body.title = fields.title;
    if (fields.description !== before.description) body.description = fields.description;
    if (fields.location !== before.location) body.location = fields.location;
    if (fields.category_id !== before.category_id) body.category_id = fields.category_id;
    if (fields.start !== before.start) body.start = fields.start;
    if (fields.end !== before.end) body.end = fields.end;
    if (Object.keys(body).length === 1) return;
    await mutations.updateOne.mutateAsync({ occurrence, body });
  }

  const heading = rangeTitle(view, date, weekStart);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Calendar settings"
              onClick={() => setSettingsOpen(true)}
              disabled={!preferences}
            >
              <Settings2 aria-hidden="true" />
            </Button>
            <Button onClick={() => openCreate()}>
              <CalendarPlus aria-hidden="true" />
              New event
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => go({ date: today })}>
          Today
        </Button>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Previous ${view === "agenda" ? "two weeks" : view}`}
            onClick={() => go({ date: shiftDate(view, date, -1) })}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Next ${view === "agenda" ? "two weeks" : view}`}
            onClick={() => go({ date: shiftDate(view, date, 1) })}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold" aria-live="polite">
          {heading}
          {refreshing ? <span className="sr-only"> (updating)</span> : null}
        </h2>
        <div role="group" aria-label="View" className="flex rounded-lg border bg-card p-0.5">
          {CALENDAR_VIEWS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={view === option.value}
              onClick={() => go({ view: option.value })}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                view === option.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <FormAlert message={actionError} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0">
          {view === "agenda" ? (
            <AgendaView
              workspaceId={workspaceId}
              date={date}
              today={today}
              timeZone={timeZone}
              categories={categoriesById}
              onOpenItem={setDetails}
              onCreate={() => openCreate()}
            />
          ) : state.status === "error" ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5"
            >
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <Button variant="outline" size="sm" onClick={reload}>
                Try again
              </Button>
            </div>
          ) : state.status === "loading" ? (
            <CalendarSkeleton />
          ) : view === "month" ? (
            <MonthView
              date={date}
              weekStart={weekStart}
              today={today}
              timeZone={timeZone}
              items={items}
              categories={categoriesById}
              onOpenItem={setDetails}
              onOpenDay={(day) => go({ view: "day", date: day })}
              onCreateOn={(day) => openCreate({ date: day, minutes: workingHours.start })}
              onMoveItem={onMoveToDate}
              onDropTask={(taskId, day) => onDropTask(taskId, day)}
            />
          ) : (
            <TimeGrid
              dates={view === "week" ? weekDates(date, weekStart) : [date]}
              today={today}
              timeZone={timeZone}
              items={items}
              categories={categoriesById}
              workingHours={workingHours}
              onOpenItem={setDetails}
              onOpenDay={view === "week" ? (day) => go({ view: "day", date: day }) : undefined}
              onCreate={(day, start, end) =>
                openCreate({ date: day, minutes: start, endMinutes: end })
              }
              onMoveTimed={onMoveTimed}
              onMoveAllDay={onMoveToDate}
              onDropTask={onDropTask}
            />
          )}
          {view !== "agenda" && state.status === "success" && items.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Nothing scheduled {view === "day" ? "this day" : `this ${view}`}. Choose a time or
              press N to add an event.
            </p>
          ) : null}
        </div>
        <aside aria-label="Calendar filters and tasks" className="min-w-0">
          <CalendarSidebar
            workspaceId={workspaceId}
            categories={categories}
            unscheduled={showUnscheduled ? unscheduled : null}
            onSchedule={setScheduling}
          />
        </aside>
      </div>

      {editor ? (
        <EventDialog
          mode={editor.mode}
          initial={editor.initial}
          categories={categories}
          tasks={openTaskList}
          onSave={saveEditor}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {details ? (
        <ItemDetails
          item={details}
          workspaceId={workspaceId}
          timeZone={timeZone}
          categories={categoriesById}
          openTasks={openTaskList}
          events={eventActions}
          tasks={taskActions}
          onClose={() => setDetails(null)}
        />
      ) : null}
      {scheduling ? (
        <ScheduleTaskDialog
          task={scheduling}
          timeZone={timeZone}
          initial={taskScheduleValues(scheduling, timeZone, {
            date: view === "agenda" ? today : date,
            minutes: workingHours.start,
          })}
          onSave={(schedule) =>
            mutations.scheduleTask.mutateAsync({ task: scheduling, schedule }).then(() => undefined)
          }
          onClose={() => setScheduling(null)}
        />
      ) : null}
      {settingsOpen && preferences ? (
        <CalendarSettingsDialog
          preferences={preferences}
          timeZone={timeZone}
          onSave={savePreferences}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {scopeDialog}
      {confirmDialog}
    </div>
  );
}
