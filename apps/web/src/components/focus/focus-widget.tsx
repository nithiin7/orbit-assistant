"use client";

import type { TaskListQuery } from "@orbit/contracts";
import { useQuery } from "@tanstack/react-query";
import { Play, Timer } from "lucide-react";

import { focusSummaryOptions, taskListOptions } from "@/api/tasks";
import { WidgetBody, WidgetCard, WidgetEmpty } from "@/components/dashboard/widget-card";
import { Button } from "@/components/ui/button";
import { queryResource } from "@/hooks/query-resource";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { formatCountdown, formatFocusTime } from "@/lib/focus";
import { useAuth } from "@/providers/auth";
import { useFocusTimer } from "@/providers/focus";
import { localDateString } from "@/utils/dates";

import {
  FocusControls,
  FocusRing,
  FocusSettingsButton,
  FocusStatus,
  useFocusClock,
} from "./focus-timer";

/** The next open tasks, to start focusing on one. */
const START_QUERY: TaskListQuery = { status: "open", sort: "due_date", limit: 4 };

/**
 * The focus timer on the dashboard: the running timer with its controls, or the next open tasks
 * to start on, and today's focus time in the active workspace.
 */
export function FocusWidget() {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const today = localDateString();
  const summary = useQuery(focusSummaryOptions(withToken, workspaceId, today));
  const tasks = useQuery(taskListOptions(withToken, workspaceId, START_QUERY));
  useWorkspaceNotFound(tasks.error ?? summary.error);
  const focus = useFocusTimer();
  const clock = useFocusClock(focus.timer);

  const todayLine = summary.data
    ? summary.data.today_sessions === 0
      ? "No focus time yet today."
      : `${formatFocusTime(summary.data.today_seconds)} today · ${summary.data.today_sessions} ${
          summary.data.today_sessions === 1 ? "session" : "sessions"
        }`
    : null;

  return (
    <WidgetCard
      title="Focus"
      icon={Timer}
      href="/tasks"
      linkLabel="Open tasks"
      actions={<FocusSettingsButton />}
    >
      <div className="widget-body space-y-4 p-5">
        {focus.timer && clock ? (
          <div className="flex items-center gap-4">
            <FocusRing
              left={clock.left}
              length={clock.length}
              onBreak={clock.onBreak}
              className="size-16"
            />
            <div className="min-w-0 flex-1">
              <FocusStatus timer={focus.timer} clock={clock} />
              <p className="text-2xl font-semibold tabular-nums">{formatCountdown(clock.left)}</p>
              <p className="truncate text-sm text-muted-foreground">{focus.timer.taskTitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <FocusControls
                running={clock.running}
                waiting={clock.waiting}
                onBreak={clock.onBreak}
              />
            </div>
          </div>
        ) : null}
        {todayLine ? <p className="text-sm text-muted-foreground">{todayLine}</p> : null}
      </div>
      {focus.timer ? null : (
        <WidgetBody
          resource={queryResource(tasks, "Couldn’t load your tasks.")}
          reload={() => void tasks.refetch()}
          label="tasks"
        >
          {(page) =>
            page.tasks.length === 0 ? (
              <WidgetEmpty>No open tasks to focus on.</WidgetEmpty>
            ) : (
              <ul aria-label="Start focusing on" className="divide-y border-t">
                {page.tasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                    <Button
                      variant="soft"
                      size="sm"
                      aria-label={`Focus on “${task.title}”`}
                      onClick={() =>
                        workspaceId &&
                        focus.start({ workspaceId, taskId: task.id, taskTitle: task.title })
                      }
                    >
                      <Play aria-hidden="true" />
                      Focus
                    </Button>
                  </li>
                ))}
              </ul>
            )
          }
        </WidgetBody>
      )}
    </WidgetCard>
  );
}
