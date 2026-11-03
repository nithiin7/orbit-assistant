"use client";

import type { HabitDetail, HabitProgress, LogHabitRequest, Routine } from "@orbit/contracts";
import { ListChecks, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { Menu } from "@/components/ui/menu";
import { useActiveWorkspaceId, useViewerTimeZone } from "@/hooks/use-calendar";
import {
  useHabit,
  useHabitAnalytics,
  useHabitCategories,
  useHabitHistory,
  useHabitList,
  useHabitMutations,
  useHabitToday,
  useRoutine,
  useRoutineList,
  useRoutineMutations,
  useRoutineSessions,
} from "@/hooks/use-habits";
import { todayIn } from "@/lib/calendar";
import {
  HABIT_VIEWS,
  type HabitFormValues,
  habitsHref,
  type HabitView,
  newHabitValues,
  newRoutineValues,
  parseHabitLocation,
  type RoutineFormValues,
  toCreateHabitRequest,
  toHabitFormValues,
  toRoutineFormValues,
  toRoutineRequest,
  toUpdateHabitRequest,
} from "@/lib/habits";
import { noteHref } from "@/lib/note-links";
import { cn } from "@/utils/common";
import { addDays } from "@/utils/dates";

import { type AnalyticsRange, HabitAnalyticsView } from "./habit-analytics";
import { HabitDetailView, HEATMAP_DAYS } from "./habit-detail";
import { HabitDialog } from "./habit-dialog";
import { HabitListView } from "./habit-list";
import { HabitTodayView } from "./habit-today";
import { RoutineDialog } from "./routine-dialog";
import { RoutineDetailView, RoutineListView } from "./routines-view";

type Dialog =
  | { kind: "habit"; editing: HabitDetail | null }
  | { kind: "routine"; editing: Routine | null }
  | null;

/** The Habits page: the view or detail page named in the URL, and the dialogs it opens. */
export function HabitsPanel() {
  const params = useSearchParams();
  const location = parseHabitLocation(params);
  const workspaceId = useActiveWorkspaceId();
  const timeZone = useViewerTimeZone();
  const [dialog, setDialog] = useState<Dialog>(null);
  const { confirm, confirmDialog } = useConfirm();

  if (workspaceId === null) return null;
  const view = location.kind === "view" ? location.view : null;

  return (
    <div className="@container space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Habit views" className="-mx-1 overflow-x-auto px-1">
          <ul className="flex gap-1">
            {HABIT_VIEWS.map((option) => (
              <li key={option.value}>
                <Link
                  href={habitsHref({ kind: "view", view: option.value })}
                  aria-current={view === option.value ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    view === option.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {option.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Menu
          items={[
            {
              id: "habit",
              label: "Habit",
              description: "Something to do on a schedule.",
              icon: Sparkles,
              onSelect: () => setDialog({ kind: "habit", editing: null }),
            },
            {
              id: "routine",
              label: "Routine",
              description: "A sequence of steps to run through.",
              icon: ListChecks,
              onSelect: () => setDialog({ kind: "routine", editing: null }),
            },
          ]}
        >
          <Plus aria-hidden="true" />
          New
        </Menu>
      </div>

      <Content
        location={location}
        workspaceId={workspaceId}
        timeZone={timeZone}
        onDialog={setDialog}
        confirm={confirm}
      />

      {dialog?.kind === "habit" ? (
        <HabitDialogContainer
          workspaceId={workspaceId}
          timeZone={timeZone}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "routine" ? (
        <RoutineDialogContainer
          workspaceId={workspaceId}
          timeZone={timeZone}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

type ContentProps = {
  location: ReturnType<typeof parseHabitLocation>;
  workspaceId: string;
  timeZone: string;
  onDialog: (dialog: Dialog) => void;
  confirm: ReturnType<typeof useConfirm>["confirm"];
};

function Content(props: ContentProps) {
  const { location } = props;
  if (location.kind === "habit") return <HabitPage {...props} habitId={location.id} />;
  if (location.kind === "routine") return <RoutinePage {...props} routineId={location.id} />;
  return <ViewPage {...props} view={location.view} />;
}

function ViewPage({ view, workspaceId, timeZone, onDialog }: ContentProps & { view: HabitView }) {
  switch (view) {
    case "today":
      return <TodayPage workspaceId={workspaceId} timeZone={timeZone} onDialog={onDialog} />;
    case "all":
    case "archived":
      return (
        <ListPage workspaceId={workspaceId} archived={view === "archived"} onDialog={onDialog} />
      );
    case "routines":
      return <RoutinesPage workspaceId={workspaceId} onDialog={onDialog} />;
    case "analytics":
      return <AnalyticsPage workspaceId={workspaceId} timeZone={timeZone} />;
  }
}

function TodayPage({
  workspaceId,
  timeZone,
  onDialog,
}: {
  workspaceId: string;
  timeZone: string;
  onDialog: (dialog: Dialog) => void;
}) {
  const router = useRouter();
  const today = useHabitToday(workspaceId, timeZone);
  const routines = useRoutineList(workspaceId, "active");
  const { log } = useHabitMutations(workspaceId);
  const { start } = useRoutineMutations(workspaceId);
  const day = today.state.status === "success" ? today.state.data.day : todayIn(timeZone);
  return (
    <HabitTodayView
      state={today.state}
      routines={routines.state.status === "success" ? routines.state.data.routines : []}
      onReload={today.reload}
      onLog={(item: HabitProgress, body: LogHabitRequest | null) =>
        log.mutateAsync({ habit: item.habit, day, body })
      }
      onCreate={() => onDialog({ kind: "habit", editing: null })}
      onStartRoutine={(routine) =>
        void start
          .mutateAsync(routine.id)
          .then(() => router.push(habitsHref({ kind: "routine", id: routine.id })))
          .catch(() => router.push(habitsHref({ kind: "routine", id: routine.id })))
      }
    />
  );
}

function ListPage({
  workspaceId,
  archived,
  onDialog,
}: {
  workspaceId: string;
  archived: boolean;
  onDialog: (dialog: Dialog) => void;
}) {
  const active = useHabitList(workspaceId, archived ? "archived" : "all");
  const state =
    active.state.status === "success" && !archived
      ? {
          ...active.state,
          data: {
            habits: active.state.data.habits.filter((item) => item.habit.status !== "archived"),
          },
        }
      : active.state;
  return (
    <HabitListView
      state={state}
      archived={archived}
      onReload={active.reload}
      onCreate={() => onDialog({ kind: "habit", editing: null })}
    />
  );
}

function RoutinesPage({
  workspaceId,
  onDialog,
}: {
  workspaceId: string;
  onDialog: (dialog: Dialog) => void;
}) {
  const router = useRouter();
  const list = useRoutineList(workspaceId, "all");
  const { start } = useRoutineMutations(workspaceId);
  return (
    <RoutineListView
      state={list.state}
      onReload={list.reload}
      onCreate={() => onDialog({ kind: "routine", editing: null })}
      onStart={(routine) =>
        void start
          .mutateAsync(routine.id)
          .finally(() => router.push(habitsHref({ kind: "routine", id: routine.id })))
      }
    />
  );
}

function AnalyticsPage({ workspaceId, timeZone }: { workspaceId: string; timeZone: string }) {
  const [range, setRange] = useState<AnalyticsRange>("90");
  const [categoryId, setCategoryId] = useState("");
  const categories = useHabitCategories(workspaceId);
  const end = todayIn(timeZone);
  const analytics = useHabitAnalytics(workspaceId, {
    start: addDays(end, -(Number(range) - 1)),
    end,
    timezone: timeZone,
    ...(categoryId ? { category_id: categoryId } : {}),
  });
  return (
    <HabitAnalyticsView
      state={analytics.state}
      refreshing={analytics.refreshing}
      range={range}
      onRangeChange={setRange}
      categoryId={categoryId}
      categories={categories}
      onCategoryChange={setCategoryId}
      onReload={analytics.reload}
    />
  );
}

function HabitPage({
  habitId,
  workspaceId,
  timeZone,
  onDialog,
  confirm,
}: ContentProps & { habitId: string }) {
  const router = useRouter();
  const habit = useHabit(workspaceId, habitId);
  const end = habit.state.status === "success" ? habit.state.data.day : todayIn(timeZone);
  const history = useHabitHistory(workspaceId, habitId, addDays(end, -(HEATMAP_DAYS - 1)), end);
  const mutations = useHabitMutations(workspaceId);
  const detail = habit.state.status === "success" ? habit.state.data : null;

  return (
    <HabitDetailView
      state={habit.state}
      history={history}
      onReload={habit.reload}
      onEdit={() => detail && onDialog({ kind: "habit", editing: detail })}
      onStatus={(status) => mutations.update.mutateAsync({ habitId, changes: { status } })}
      onDelete={() =>
        void confirm({
          title: "Delete this habit?",
          description:
            "Its history, reminders, and links go with it. Archive it instead to keep the history.",
          confirmLabel: "Delete habit",
          destructive: true,
        }).then(async (ok) => {
          if (!ok) return;
          await mutations.remove.mutateAsync(habitId);
          router.push(habitsHref({ kind: "view", view: "all" }));
        })
      }
      onLog={(day, body) =>
        detail
          ? mutations.log.mutateAsync({ habit: detail.habit, day, body })
          : Promise.resolve(null)
      }
      onCreateTask={(title) =>
        mutations.createTask.mutateAsync({
          habitId,
          body: { title, description: "", priority: "none", due_date: null },
        })
      }
      onUnlinkTask={(taskId) => mutations.unlinkTask.mutateAsync({ habitId, taskId })}
      onReflect={(day) => mutations.createNote.mutateAsync({ habitId, day })}
      onUnlinkNote={(noteId) => mutations.unlinkNote.mutateAsync({ habitId, noteId })}
      onOpenNote={(noteId) => router.push(noteHref(noteId))}
    />
  );
}

function RoutinePage({
  routineId,
  workspaceId,
  onDialog,
  confirm,
}: ContentProps & { routineId: string }) {
  const router = useRouter();
  const routine = useRoutine(workspaceId, routineId);
  const sessions = useRoutineSessions(workspaceId, routineId);
  const mutations = useRoutineMutations(workspaceId);
  const current = routine.state.status === "success" ? routine.state.data : null;

  return (
    <RoutineDetailView
      state={routine.state}
      sessions={sessions}
      onReload={routine.reload}
      onEdit={() => current && onDialog({ kind: "routine", editing: current })}
      onStatus={(status) => void mutations.update.mutateAsync({ routineId, changes: { status } })}
      onDelete={() =>
        void confirm({
          title: "Delete this routine?",
          description: "Its past sessions and reminders go with it. Archive it to keep them.",
          confirmLabel: "Delete routine",
          destructive: true,
        }).then(async (ok) => {
          if (!ok) return;
          await mutations.remove.mutateAsync(routineId);
          router.push(habitsHref({ kind: "view", view: "routines" }));
        })
      }
      onStart={() => mutations.start.mutateAsync(routineId)}
      onStep={(session, stepId, status) =>
        mutations.setStep.mutateAsync({ routineId, sessionId: session.id, stepId, status })
      }
      onFinish={(session, status, notes) =>
        mutations.updateSession.mutateAsync({
          routineId,
          sessionId: session.id,
          body: { status, notes },
        })
      }
      onNote={(session) => mutations.createNote.mutateAsync({ routineId, sessionId: session.id })}
      onOpenNote={(noteId) => router.push(noteHref(noteId))}
    />
  );
}

function HabitDialogContainer({
  workspaceId,
  timeZone,
  editing,
  onClose,
}: {
  workspaceId: string;
  timeZone: string;
  editing: HabitDetail | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const categories = useHabitCategories(workspaceId);
  const { create, update } = useHabitMutations(workspaceId);
  const initial = editing
    ? toHabitFormValues(editing.habit, editing.reminders)
    : newHabitValues(todayIn(timeZone), timeZone);

  async function save(values: HabitFormValues) {
    if (editing) {
      const { changes, reminders } = toUpdateHabitRequest(editing.habit, values);
      await update.mutateAsync({ habitId: editing.habit.id, changes, reminders });
      return;
    }
    const created = await create.mutateAsync(toCreateHabitRequest(values));
    router.push(habitsHref({ kind: "habit", id: created.habit.id }));
  }

  return (
    <HabitDialog
      editing={editing !== null}
      initial={initial}
      categories={categories}
      onSave={save}
      onClose={onClose}
    />
  );
}

function RoutineDialogContainer({
  workspaceId,
  timeZone,
  editing,
  onClose,
}: {
  workspaceId: string;
  timeZone: string;
  editing: Routine | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const habits = useHabitList(workspaceId, "active");
  const { create, update } = useRoutineMutations(workspaceId);
  const initial = editing ? toRoutineFormValues(editing) : newRoutineValues(timeZone);

  async function save(values: RoutineFormValues) {
    const { reminders, ...fields } = toRoutineRequest(values, editing ?? undefined);
    if (editing) {
      await update.mutateAsync({ routineId: editing.id, changes: fields, reminders });
      return;
    }
    const created = await create.mutateAsync({ ...fields, reminders });
    router.push(habitsHref({ kind: "routine", id: created.id }));
  }

  return (
    <RoutineDialog
      editing={editing !== null}
      initial={initial}
      habits={
        habits.state.status === "success" ? habits.state.data.habits.map((item) => item.habit) : []
      }
      onSave={save}
      onClose={onClose}
    />
  );
}
