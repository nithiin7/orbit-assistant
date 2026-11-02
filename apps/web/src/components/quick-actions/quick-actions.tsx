"use client";

import type { CreateTaskRequest } from "@orbit/contracts";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { addWater } from "@/api/fitness";
import { taskListOptions } from "@/api/tasks";
import { NewEventDialog, nextEventValues } from "@/components/calendar/calendar-widget";
import { TransactionDialog } from "@/components/finance/transaction-dialog";
import { useStartWorkout } from "@/components/fitness/workouts";
import { useQuickCapture } from "@/components/notes/quick-capture";
import { ReminderDialog } from "@/components/reminders/reminder-dialog";
import { TaskComposer } from "@/components/tasks/task-composer";
import { Button } from "@/components/ui/button";
import {
  useActiveWorkspaceId,
  useCalendarCategories,
  useViewerTimeZone,
} from "@/hooks/use-calendar";
import { useFinanceSetup } from "@/hooks/use-finance";
import { useFitnessAction, useFitnessProfile } from "@/hooks/use-fitness";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { useReminderMutations } from "@/hooks/use-reminders";
import { useTaskMutations } from "@/hooks/use-tasks";
import { todayIn } from "@/lib/calendar";
import { documentsHref } from "@/lib/documents";
import { formatWater } from "@/lib/fitness";
import { useAuth, useCurrentUser } from "@/providers/auth";

/** Things Orbit can create or record from anywhere, without opening the module first. */
export type QuickAction =
  "task" | "note" | "event" | "reminder" | "expense" | "water" | "workout" | "document";

type DialogAction = "task" | "event" | "reminder" | "expense";

type QuickActionsValue = {
  /** Open the action's dialog, or do it at once (water, a workout, a quick note). */
  run: (action: QuickAction) => void;
  /** The last action's outcome, for a polite status region. */
  message: string;
  /** Set when the last action that ran at once failed. */
  error: string | null;
  /** How much one tap of "water" records, in the person's unit. */
  waterLabel: string;
};

const QuickActionsContext = createContext<QuickActionsValue | null>(null);

export function useQuickActions(): QuickActionsValue {
  const context = useContext(QuickActionsContext);
  if (!context) throw new Error("useQuickActions must be used within QuickActionsProvider.");
  return context;
}

const DEFAULT_WATER_ML = 250;

/**
 * Quick creation from the dashboard and the command palette. Each action reuses its module's
 * own dialog and mutations (the task composer, event, reminder, and transaction dialogs, quick
 * capture, water logging, starting a workout), so there is one way to create each thing.
 * Uploading a document opens the vault's upload, which validates the file there.
 */
export function QuickActionsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const quickCapture = useQuickCapture();
  const workspaceId = useActiveWorkspaceId();
  const timeZone = useViewerTimeZone();
  const today = todayIn(timeZone);
  const [dialog, setDialog] = useState<DialogAction | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const runFitness = useFitnessAction(workspaceId ?? "");
  const startWorkout = useStartWorkout(workspaceId ?? "", today, timeZone);
  // The profile loads only once water is used, so the quick amount and unit are known.
  const [usedWater, setUsedWater] = useState(false);
  const profile = useFitnessProfile(usedWater ? workspaceId : null);
  const profileData = profile.state.status === "success" ? profile.state.data : null;
  const waterMl = profileData?.water_quick_amounts_ml[0] ?? DEFAULT_WATER_ML;
  const waterLabel = formatWater(waterMl, profileData?.water_unit ?? "ml");

  const run = (action: QuickAction) => {
    setError(null);
    if (workspaceId === null) return;
    switch (action) {
      case "note":
        quickCapture.open();
        return;
      case "document":
        router.push(`${documentsHref({ view: "all" })}&upload=1`);
        return;
      case "water":
        setUsedWater(true);
        runFitness((token) => addWater(token, workspaceId, today, waterMl), {
          touches: ["habits"],
        }).then(
          () => setMessage(`Recorded ${waterLabel} of water.`),
          (reason: unknown) => setError(describeApiError(reason, "Couldn’t add the water.")),
        );
        return;
      case "workout":
        startWorkout(null).catch((reason: unknown) =>
          setError(describeApiError(reason, "Couldn’t start the workout.")),
        );
        return;
      default:
        setDialog(action);
    }
  };
  const value: QuickActionsValue = { run, message, error, waterLabel };

  const close = () => setDialog(null);
  const done = (text: string) => setMessage(text);

  return (
    <QuickActionsContext.Provider value={value}>
      {children}
      {workspaceId && dialog === "task" ? (
        <NewTaskDialog workspaceId={workspaceId} onClose={close} onCreated={done} />
      ) : null}
      {workspaceId && dialog === "event" ? (
        <EventAction
          workspaceId={workspaceId}
          timeZone={timeZone}
          onClose={close}
          onCreated={done}
        />
      ) : null}
      {workspaceId && dialog === "reminder" ? (
        <ReminderAction workspaceId={workspaceId} onClose={close} onCreated={done} />
      ) : null}
      {workspaceId && dialog === "expense" ? (
        <ExpenseAction workspaceId={workspaceId} onClose={close} onCreated={done} />
      ) : null}
    </QuickActionsContext.Provider>
  );
}

type ActionProps = {
  workspaceId: string;
  onClose: () => void;
  onCreated: (message: string) => void;
};

/** A small dialog around the Tasks page's quick-entry bar. */
function NewTaskDialog({ workspaceId, onClose, onCreated }: ActionProps) {
  const id = useId();
  const { close, dialogProps } = useModalDialog({ onClose });
  const { create } = useTaskMutations(workspaceId);

  async function save(draft: CreateTaskRequest) {
    const task = await create.mutateAsync(draft);
    onCreated(`Added “${task.title}” to Tasks.`);
    close();
  }

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-heading`} className="text-base font-semibold">
            New task
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="-mt-1 -mr-2 size-8"
            aria-label="Close"
            onClick={close}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <TaskComposer onCreate={save} />
      </div>
    </dialog>
  );
}

function EventAction({
  workspaceId,
  timeZone,
  onClose,
  onCreated,
}: ActionProps & { timeZone: string }) {
  const { categories } = useCalendarCategories(workspaceId);
  const [initial] = useState(() => nextEventValues(timeZone));
  return (
    <NewEventDialog
      workspaceId={workspaceId}
      initial={initial}
      categories={categories}
      onClose={onClose}
      onCreated={(title) => onCreated(`Added “${title}” to the calendar.`)}
    />
  );
}

function ReminderAction({ workspaceId, onClose, onCreated }: ActionProps) {
  const { withToken } = useAuth();
  const user = useCurrentUser();
  const timeZone = useViewerTimeZone();
  const { create } = useReminderMutations(workspaceId);
  // Open tasks, so the reminder can be about one; the dialog works without them.
  const tasks = useQuery(
    taskListOptions(withToken, workspaceId, { status: "open", sort: "due_date", limit: 100 }),
  );
  return (
    <ReminderDialog
      reminder={null}
      tasks={tasks.data?.tasks ?? []}
      defaultTimeZone={user.timezone ?? timeZone}
      onSave={async (fields) => {
        const saved = await create.mutateAsync({ ...fields, enabled: true });
        onCreated(`Saved the reminder “${saved.title}”.`);
      }}
      onClose={onClose}
    />
  );
}

/** The Finance page's transaction dialog, for an expense, once accounts and categories load. */
function ExpenseAction({ workspaceId, onClose, onCreated }: ActionProps) {
  const { accounts, categories, reload } = useFinanceSetup(workspaceId);
  if (accounts.status === "error" || categories.status === "error") {
    return (
      <ActionError
        message={
          accounts.status === "error"
            ? accounts.message
            : categories.status === "error"
              ? categories.message
              : ""
        }
        onRetry={reload}
        onClose={onClose}
      />
    );
  }
  if (accounts.status !== "success" || categories.status !== "success") return null;
  return (
    <TransactionDialog
      workspaceId={workspaceId}
      type="expense"
      accounts={accounts.data.accounts}
      categories={categories.data}
      onSaved={onCreated}
      onClose={onClose}
    />
  );
}

/** Shown when what a dialog needs couldn't load. */
function ActionError({
  message,
  onRetry,
  onClose,
}: {
  message: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const { close, dialogProps } = useModalDialog({ onClose });
  return (
    <dialog
      {...dialogProps}
      role="alertdialog"
      aria-labelledby={`${id}-heading`}
      aria-describedby={`${id}-message`}
      className="dialog-motion dialog-pop mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-sm rounded-xl border bg-popover p-5 text-popover-foreground shadow-elevation-3"
    >
      <h2 id={`${id}-heading`} className="text-base font-semibold">
        Couldn’t open this
      </h2>
      <p id={`${id}-message`} className="mt-2 text-sm text-muted-foreground">
        {message}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={close}>
          Close
        </Button>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </dialog>
  );
}
