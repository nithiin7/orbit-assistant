"use client";

import type { CreateTaskRequest, Task, TaskListQuery, TaskPriority } from "@orbit/contracts";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, Flag } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { taskListOptions, taskSummaryOptions } from "@/api/tasks";
import {
  WidgetBody,
  WidgetCard,
  WidgetEmpty,
  WidgetTabs,
} from "@/components/dashboard/widget-card";
import { Checkbox } from "@/components/ui/checkbox";
import { Menu } from "@/components/ui/menu";
import { queryResource } from "@/hooks/query-resource";
import { useActiveWorkspaceId, useViewerTimeZone } from "@/hooks/use-calendar";
import { useTaskMutations } from "@/hooks/use-tasks";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { todayIn } from "@/lib/calendar";
import { PRIORITIES } from "@/lib/tasks";
import { useAuth } from "@/providers/auth";
import { cn } from "@/utils/common";
import { addDays } from "@/utils/dates";

import { TaskComposer } from "./task-composer";
import { DueDateLabel, PriorityBadge } from "./task-meta";

type Focus = "today" | "priority" | "upcoming" | "done";

const SHOWN = 6;
/** How far ahead "Upcoming" looks, in days. */
const UPCOMING_DAYS = 14;

/** The task list behind each choice; each is a small page of the existing task list. */
function focusQuery(focus: Focus, today: string): TaskListQuery {
  switch (focus) {
    case "today":
      // Overdue first, then today's, highest priority first within a day.
      return { status: "open", due_to: today, sort: "due_date", limit: SHOWN };
    case "priority":
      return { status: "open", priority: ["high", "medium"], sort: "priority", limit: SHOWN };
    case "upcoming":
      return {
        status: "open",
        due_from: addDays(today, 1),
        due_to: addDays(today, UPCOMING_DAYS),
        sort: "due_date",
        limit: SHOWN,
      };
    case "done":
      return { status: "completed", sort: "completed_at", limit: SHOWN };
  }
}

const EMPTY: Record<Focus, string> = {
  today: "Nothing due today. Enjoy the space.",
  priority: "No high or medium priority tasks open.",
  upcoming: `Nothing due in the next ${UPCOMING_DAYS} days.`,
  done: "Nothing completed yet.",
};

/**
 * Today's tasks, priorities, upcoming deadlines, and recently completed tasks, for the
 * dashboard. Tasks can be added, completed, reopened, and reprioritized in place; each change
 * goes through the Tasks module's own mutations.
 */
export function TaskWidget() {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const timeZone = useViewerTimeZone();
  const today = todayIn(timeZone);
  const [focus, setFocus] = useState<Focus>("today");
  const list = useQuery(taskListOptions(withToken, workspaceId, focusQuery(focus, today)));
  const summary = useQuery(taskSummaryOptions(withToken, workspaceId, { today }));
  useWorkspaceNotFound(list.error ?? summary.error);
  const mutations = useTaskMutations(workspaceId ?? "");
  const [error, setError] = useState<string | null>(null);

  const dueNow = summary.data ? summary.data.due_today + summary.data.overdue : undefined;
  const options = [
    { value: "today" as const, label: "Today", count: dueNow },
    { value: "priority" as const, label: "Priority" },
    { value: "upcoming" as const, label: "Upcoming" },
    { value: "done" as const, label: "Completed" },
  ];

  async function create(draft: CreateTaskRequest) {
    // Added from "Today" without a date, a task is due today, so it stays in view.
    const dated = focus === "today" && !draft.due_date ? { ...draft, due_date: today } : draft;
    await mutations.create.mutateAsync(dated);
  }

  function toggle(task: Task) {
    setError(null);
    mutations.toggle.mutateAsync(task).catch(() => setError("Couldn’t update that task."));
  }

  function prioritize(task: Task, priority: TaskPriority) {
    setError(null);
    mutations.update
      .mutateAsync({ task, changes: { priority } })
      .catch(() => setError("Couldn’t change the priority."));
  }

  return (
    <WidgetCard
      title="Tasks"
      icon={CheckSquare}
      href="/tasks"
      linkLabel="Open tasks"
      busy={list.isPending}
    >
      <div className="space-y-3 px-5 pt-4">
        <WidgetTabs label="Show tasks" options={options} value={focus} onChange={setFocus} />
        {workspaceId ? <TaskComposer onCreate={create} /> : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <WidgetBody
        resource={queryResource(list, "Couldn’t load your tasks.")}
        reload={() => void list.refetch()}
        label="tasks"
      >
        {(data) =>
          data.tasks.length === 0 ? (
            <WidgetEmpty>{EMPTY[focus]}</WidgetEmpty>
          ) : (
            <div className="p-5 pt-3">
              <ul className="divide-y rounded-lg border">
                {data.tasks.map((task) => (
                  <TaskLine
                    key={task.id}
                    task={task}
                    today={today}
                    onToggle={() => toggle(task)}
                    onPrioritize={(priority) => prioritize(task, priority)}
                  />
                ))}
              </ul>
              {data.total > data.tasks.length ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  And {data.total - data.tasks.length} more in{" "}
                  <Link
                    href="/tasks"
                    className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Tasks
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          )
        }
      </WidgetBody>
    </WidgetCard>
  );
}

function TaskLine({
  task,
  today,
  onToggle,
  onPrioritize,
}: {
  task: Task;
  today: string;
  onToggle: () => void;
  onPrioritize: (priority: TaskPriority) => void;
}) {
  const done = task.status === "completed";
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <Checkbox
        shape="round"
        checked={done}
        onChange={onToggle}
        aria-label={done ? `Reopen “${task.title}”` : `Complete “${task.title}”`}
      />
      <Link
        href={`/tasks?task=${encodeURIComponent(task.id)}`}
        className={cn(
          "min-w-0 flex-1 truncate rounded-sm text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
          done && "text-muted-foreground line-through",
        )}
      >
        {task.title}
      </Link>
      <PriorityBadge priority={task.priority} />
      {task.due_date ? <DueDateLabel dueDate={task.due_date} today={today} muted={done} /> : null}
      {done ? null : (
        <Menu
          aria-label={`Priority of “${task.title}”`}
          variant="ghost"
          size="icon"
          className="size-7"
          align="end"
          items={PRIORITIES.map((option) => ({
            id: option.value,
            label: option.label,
            checked: option.value === task.priority,
            onSelect: () => {
              if (option.value !== task.priority) onPrioritize(option.value);
            },
          }))}
        >
          <Flag aria-hidden="true" />
        </Menu>
      )}
    </li>
  );
}
