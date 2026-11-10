import type {
  CreateTaskListRequest,
  CreateTaskRequest,
  Task,
  TaskList,
  TaskListDetail,
  TaskListQuery,
  TaskLists,
  TaskSummary,
  TaskSummaryQuery,
  UpdateTaskListRequest,
  UpdateTaskRequest,
} from "@orbit/contracts";

import { request, type Signal, toQueryString, workspacePath } from "../client";

function tasksPath(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/tasks${suffix}`);
}

function taskPath(workspaceId: string, taskId: string, suffix = ""): string {
  return tasksPath(workspaceId, `/${encodeURIComponent(taskId)}${suffix}`);
}

export function listTasks(
  token: string,
  workspaceId: string,
  query: TaskListQuery = {},
  { signal }: Signal = {},
): Promise<TaskList> {
  return request<TaskList>(`${tasksPath(workspaceId)}${toQueryString(query)}`, { token, signal });
}

/** Task counts; `today` (the user's local date) decides what is overdue or due today. */
export function getTaskSummary(
  token: string,
  workspaceId: string,
  query: TaskSummaryQuery = {},
  { signal }: Signal = {},
): Promise<TaskSummary> {
  return request<TaskSummary>(`${tasksPath(workspaceId, "/summary")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function getTask(
  token: string,
  workspaceId: string,
  taskId: string,
  { signal }: Signal = {},
): Promise<Task> {
  return request<Task>(taskPath(workspaceId, taskId), { token, signal });
}

export function createTask(
  token: string,
  workspaceId: string,
  body: CreateTaskRequest,
): Promise<Task> {
  return request<Task>(tasksPath(workspaceId), { method: "POST", body, token });
}

export function updateTask(
  token: string,
  workspaceId: string,
  taskId: string,
  body: UpdateTaskRequest,
): Promise<Task> {
  return request<Task>(taskPath(workspaceId, taskId), { method: "PATCH", body, token });
}

export function completeTask(token: string, workspaceId: string, taskId: string): Promise<Task> {
  return request<Task>(taskPath(workspaceId, taskId, "/complete"), { method: "POST", token });
}

export function reopenTask(token: string, workspaceId: string, taskId: string): Promise<Task> {
  return request<Task>(taskPath(workspaceId, taskId, "/reopen"), { method: "POST", token });
}

export function deleteTask(token: string, workspaceId: string, taskId: string): Promise<void> {
  return request<void>(taskPath(workspaceId, taskId), { method: "DELETE", token });
}

// Lists (Work, Personal, ...) that tasks can be on.

function taskListPath(workspaceId: string, listId = ""): string {
  return workspacePath(workspaceId, `/task-lists${listId && `/${encodeURIComponent(listId)}`}`);
}

/** The workspace's task lists, oldest first, each with its number of open tasks. */
export function listTaskLists(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<TaskLists> {
  return request<TaskLists>(taskListPath(workspaceId), { token, signal });
}

export function createTaskList(
  token: string,
  workspaceId: string,
  body: CreateTaskListRequest,
): Promise<TaskListDetail> {
  return request<TaskListDetail>(taskListPath(workspaceId), { method: "POST", body, token });
}

export function updateTaskList(
  token: string,
  workspaceId: string,
  listId: string,
  body: UpdateTaskListRequest,
): Promise<TaskListDetail> {
  return request<TaskListDetail>(taskListPath(workspaceId, listId), {
    method: "PATCH",
    body,
    token,
  });
}

/** Delete a list. Its tasks stay, on no list. */
export function deleteTaskList(token: string, workspaceId: string, listId: string): Promise<void> {
  return request<void>(taskListPath(workspaceId, listId), { method: "DELETE", token });
}
