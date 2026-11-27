"use client";

import type {
  CreateReminderRequest,
  Reminder,
  ReminderList,
  ReminderListQuery,
  UpdateReminderRequest,
} from "@orbit/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  createReminder,
  deleteReminder,
  reminderKeys,
  reminderListOptions,
  upcomingRemindersOptions,
  updateCachedReminders,
  updateReminder,
} from "@/api/reminders";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useUndoableDelete } from "@/hooks/use-undoable-delete";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";
import { useWorkspaces } from "@/providers/workspace";

/** The workspace's reminders for `query`. The previous results stay visible while it changes. */
export function useReminderList(
  workspaceId: string,
  query: ReminderListQuery,
): { state: Resource<ReminderList>; refreshing: boolean; reload: () => void } {
  const { withToken } = useAuth();
  const result = useQuery({
    ...reminderListOptions(withToken, workspaceId, query),
    placeholderData: keepPreviousData,
  });
  useWorkspaceNotFound(result.error);

  const state = queryResource(result, "Couldn’t load your reminders.");
  const { refetch } = result;
  const reload = useCallback(() => void refetch(), [refetch]);
  return { state, refreshing: state.status === "success" && result.isFetching, reload };
}

const DASHBOARD_LIMIT = 5;

/** The next few reminders in the active workspace, for the dashboard. */
export function useUpcomingReminders(): { resource: Resource<Reminder[]>; reload: () => void } {
  const { withToken } = useAuth();
  const { state: workspaces } = useWorkspaces();
  const workspaceId = workspaces.status === "ready" ? workspaces.active.id : null;
  const result = useQuery(
    upcomingRemindersOptions(withToken, workspaceId, { limit: DASHBOARD_LIMIT }),
  );
  useWorkspaceNotFound(result.error);

  const page = queryResource(result, "Couldn’t load your reminders.");
  const resource: Resource<Reminder[]> =
    page.status === "success" ? { status: "success", data: page.data.reminders } : page;
  const { refetch } = result;
  const reload = useCallback(() => void refetch(), [refetch]);
  return { resource, reload };
}

/**
 * Reminder changes for the workspace. Each refetches the workspace's reminder queries, since a
 * change can move a reminder to another status or position. Await `mutateAsync` for failures.
 */
export function useReminderMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const refetchReminders = () =>
    void queryClient.invalidateQueries({ queryKey: reminderKeys.all(workspaceId) });

  const create = useMutation({
    mutationFn: (draft: CreateReminderRequest) =>
      withToken((token) => createReminder(token, workspaceId, draft)),
    onSuccess: refetchReminders,
  });

  const update = useMutation({
    mutationFn: ({ reminder, changes }: { reminder: Reminder; changes: UpdateReminderRequest }) =>
      withToken((token) => updateReminder(token, workspaceId, reminder.id, changes)),
    // Turning a reminder on or off shows at once; the refetch then brings its new status.
    onMutate: async ({ reminder, changes }) => {
      const { enabled } = changes;
      if (typeof enabled !== "boolean") return;
      await queryClient.cancelQueries({ queryKey: reminderKeys.all(workspaceId) });
      updateCachedReminders(queryClient, workspaceId, (reminders) =>
        reminders.map((item) => (item.id === reminder.id ? { ...item, enabled } : item)),
      );
    },
    onSuccess: refetchReminders,
    onError: refetchReminders,
  });

  const remove = useMutation({
    mutationFn: (reminder: Reminder) =>
      withToken((token) => deleteReminder(token, workspaceId, reminder.id)),
    onSuccess: refetchReminders,
  });

  return { create, update, remove };
}

/**
 * Delete a reminder with Undo: it leaves the list at once and `remove` (from
 * `useReminderMutations`) runs once the Undo toast goes. Needs `ToastProvider`.
 */
export function useDeleteReminderWithUndo(
  workspaceId: string,
  remove: (reminder: Reminder) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  const undoableDelete = useUndoableDelete();
  return (reminder: Reminder) =>
    void undoableDelete({
      message: `Deleted “${reminder.title}”.`,
      queryKey: reminderKeys.all(workspaceId),
      hide: () =>
        updateCachedReminders(queryClient, workspaceId, (reminders) =>
          reminders.filter((item) => item.id !== reminder.id),
        ),
      commit: () => remove(reminder),
      failure: "Couldn’t delete the reminder. Try again.",
    });
}
