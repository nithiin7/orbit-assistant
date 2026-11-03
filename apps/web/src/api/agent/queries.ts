import type { AgentApprovalStatus } from "@orbit/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import {
  type ExecutionQuery,
  getAgentExecution,
  getAgentOverview,
  listAgentApprovals,
  listAgentExecutions,
  listAgentMemories,
  listAgentTools,
  listAgentWorkflows,
} from "./requests";

/** How often views with runs in progress refresh while open: the worker moves them along. */
export const ACTIVE_REFRESH_MS = 5_000;

export const agentKeys = {
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "agent"] as const,
  overview: (workspaceId: string | null) => [...agentKeys.all(workspaceId), "overview"] as const,
  tools: (workspaceId: string | null) => [...agentKeys.all(workspaceId), "tools"] as const,
  workflows: (workspaceId: string | null) => [...agentKeys.all(workspaceId), "workflows"] as const,
  executions: (workspaceId: string | null, query: ExecutionQuery = {}) =>
    [...agentKeys.all(workspaceId), "executions", query] as const,
  execution: (workspaceId: string | null, executionId: string) =>
    [...agentKeys.all(workspaceId), "execution", executionId] as const,
  approvals: (workspaceId: string | null, status: readonly AgentApprovalStatus[]) =>
    [...agentKeys.all(workspaceId), "approvals", status] as const,
  memories: (workspaceId: string | null) => [...agentKeys.all(workspaceId), "memories"] as const,
};

export function agentOverviewOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: agentKeys.overview(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => getAgentOverview(token, workspaceId, { signal })),
  });
}

export function agentToolsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: agentKeys.tools(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listAgentTools(token, workspaceId, { signal })),
  });
}

export function agentWorkflowsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: agentKeys.workflows(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listAgentWorkflows(token, workspaceId, { signal })),
  });
}

export function agentExecutionsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: ExecutionQuery = {},
) {
  return queryOptions({
    queryKey: agentKeys.executions(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listAgentExecutions(token, workspaceId, query, { signal })),
  });
}

export function agentExecutionOptions(
  withToken: WithToken,
  workspaceId: string | null,
  executionId: string | null,
) {
  return queryOptions({
    queryKey: agentKeys.execution(workspaceId, executionId ?? ""),
    queryFn:
      workspaceId === null || executionId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getAgentExecution(token, workspaceId, executionId, { signal })),
  });
}

export function agentApprovalsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  status: readonly AgentApprovalStatus[] = [],
) {
  return queryOptions({
    queryKey: agentKeys.approvals(workspaceId, status),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listAgentApprovals(token, workspaceId, status, { signal })),
  });
}

export function agentMemoriesOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: agentKeys.memories(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listAgentMemories(token, workspaceId, null, { signal })),
  });
}
