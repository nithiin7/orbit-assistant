"use client";

import type { Task, TaskSummary } from "@orbit/contracts";
import { ArrowRight, CheckSquare } from "lucide-react";
import Link from "next/link";

import { getTaskSummary, listTasks } from "@/api/tasks";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaceResource } from "@/hooks/use-workspace-resource";
import { localDateString } from "@/lib/tasks";
import { cn } from "@/lib/utils";

import { DueDateLabel, PriorityBadge } from "./task-meta";

const UP_NEXT_COUNT = 5;

type TaskOverviewData = { summary: TaskSummary; upNext: Task[]; today: string };

async function loadTaskOverview(
  workspaceId: string,
  token: string,
  signal: AbortSignal,
): Promise<TaskOverviewData> {
  // The user's local date decides what counts as overdue or due today.
  const today = localDateString();
  const [summary, upNext] = await Promise.all([
    getTaskSummary(token, workspaceId, { today }, { signal }),
    listTasks(
      token,
      workspaceId,
      { status: "open", sort: "due_date", limit: UP_NEXT_COUNT },
      { signal },
    ),
  ]);
  return { summary, upNext: upNext.tasks, today };
}

/** Task counts and the next open tasks in the active workspace, for the dashboard. */
export function TaskOverview() {
  const { resource, reload } = useWorkspaceResource<TaskOverviewData>(loadTaskOverview);

  return (
    <section aria-labelledby="task-overview-heading" className="h-full">
      <Card className="h-full shadow-elevation-1" aria-busy={resource.status === "loading"}>
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <h2
            id="task-overview-heading"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <CheckSquare className="size-4 text-muted-foreground" aria-hidden="true" />
            Tasks
          </h2>
          <Link href="/tasks" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Open tasks
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>

        {resource.status === "loading" ? (
          <div className="space-y-4 p-5">
            <span className="sr-only">Loading tasks…</span>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((item) => (
                <Skeleton key={item} className="h-16" />
              ))}
            </div>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : resource.status === "error" ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm text-muted-foreground">{resource.message}</p>
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : (
          <TaskOverviewContent data={resource.data} />
        )}
      </Card>
    </section>
  );
}

function TaskOverviewContent({ data: { summary, upNext, today } }: { data: TaskOverviewData }) {
  const stats = [
    { label: "Open", value: summary.open, tone: "" },
    { label: "Due today", value: summary.due_today, tone: summary.due_today ? "text-brand" : "" },
    { label: "Overdue", value: summary.overdue, tone: summary.overdue ? "text-destructive" : "" },
    { label: "Completed", value: summary.completed, tone: "" },
  ];

  return (
    <div className="space-y-5 p-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border bg-background px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className={cn("text-xl font-semibold tabular-nums", stat.tone)}>{stat.value}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Up next</h3>
        {upNext.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {summary.completed > 0
              ? "No open tasks. You’re all caught up."
              : "No tasks in this workspace yet."}{" "}
            <Link
              href="/tasks"
              className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Add a task
            </Link>
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {upNext.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                <PriorityBadge priority={task.priority} />
                {task.due_date ? <DueDateLabel dueDate={task.due_date} today={today} /> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
