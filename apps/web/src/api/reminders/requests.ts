import type {
  CreateReminderRequest,
  Reminder,
  ReminderList,
  ReminderListQuery,
  UpcomingReminders,
  UpcomingRemindersQuery,
  UpdateReminderRequest,
} from "@orbit/contracts";

import { request, type Signal, toQueryString, workspacePath } from "../client";

function remindersPath(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/reminders${suffix}`);
}

function reminderPath(workspaceId: string, reminderId: string): string {
  return remindersPath(workspaceId, `/${encodeURIComponent(reminderId)}`);
}

export function listReminders(
  token: string,
  workspaceId: string,
  query: ReminderListQuery = {},
  { signal }: Signal = {},
): Promise<ReminderList> {
  return request<ReminderList>(`${remindersPath(workspaceId)}${toQueryString(query)}`, {
    token,
    signal,
  });
}

/** Enabled reminders by next occurrence, soonest first, including any that are already due. */
export function listUpcomingReminders(
  token: string,
  workspaceId: string,
  query: UpcomingRemindersQuery = {},
  { signal }: Signal = {},
): Promise<UpcomingReminders> {
  return request<UpcomingReminders>(
    `${remindersPath(workspaceId, "/upcoming")}${toQueryString(query)}`,
    { token, signal },
  );
}

export function createReminder(
  token: string,
  workspaceId: string,
  body: CreateReminderRequest,
): Promise<Reminder> {
  return request<Reminder>(remindersPath(workspaceId), { method: "POST", body, token });
}

/** Also enables and disables a reminder (`enabled`). */
export function updateReminder(
  token: string,
  workspaceId: string,
  reminderId: string,
  body: UpdateReminderRequest,
): Promise<Reminder> {
  return request<Reminder>(reminderPath(workspaceId, reminderId), {
    method: "PATCH",
    body,
    token,
  });
}

export function deleteReminder(
  token: string,
  workspaceId: string,
  reminderId: string,
): Promise<void> {
  return request<void>(reminderPath(workspaceId, reminderId), { method: "DELETE", token });
}
