import type {
  Agent,
  AgentApproval,
  AgentApprovalList,
  AgentApprovalStatus,
  AgentExecution,
  AgentExecutionDetail,
  AgentExecutionList,
  AgentExecutionStatus,
  AgentMemory,
  AgentMemoryCategory,
  AgentMemoryList,
  AgentOverview,
  AgentToolList,
  AgentWorkflow,
  AgentWorkflowList,
  AgentWorkflowRequest,
  StartAgentRunRequest,
  UpdateAgentRequest,
} from "@orbit/contracts";

import { request, type Signal, toQueryString, workspacePath } from "../client";

function base(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/agent${suffix}`);
}

function id(value: string): string {
  return encodeURIComponent(value);
}

// The agent

export function getAgentOverview(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<AgentOverview> {
  return request<AgentOverview>(base(workspaceId), { token, signal });
}

export function updateAgent(
  token: string,
  workspaceId: string,
  body: UpdateAgentRequest,
): Promise<Agent> {
  return request<Agent>(base(workspaceId), { method: "PATCH", body, token });
}

export function listAgentTools(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<AgentToolList> {
  return request<AgentToolList>(base(workspaceId, "/tools"), { token, signal });
}

// Runs and history

export function startAgentRun(
  token: string,
  workspaceId: string,
  body: StartAgentRunRequest,
): Promise<AgentExecution> {
  return request<AgentExecution>(base(workspaceId, "/runs"), { method: "POST", body, token });
}

export type ExecutionQuery = {
  status?: readonly AgentExecutionStatus[];
  workflow_id?: string;
  limit?: number;
};

export function listAgentExecutions(
  token: string,
  workspaceId: string,
  query: ExecutionQuery = {},
  { signal }: Signal = {},
): Promise<AgentExecutionList> {
  return request<AgentExecutionList>(base(workspaceId, `/executions${toQueryString(query)}`), {
    token,
    signal,
  });
}

export function getAgentExecution(
  token: string,
  workspaceId: string,
  executionId: string,
  { signal }: Signal = {},
): Promise<AgentExecutionDetail> {
  return request<AgentExecutionDetail>(base(workspaceId, `/executions/${id(executionId)}`), {
    token,
    signal,
  });
}

export function changeAgentExecution(
  token: string,
  workspaceId: string,
  executionId: string,
  action: "cancel" | "retry",
): Promise<AgentExecution> {
  return request<AgentExecution>(base(workspaceId, `/executions/${id(executionId)}/${action}`), {
    method: "POST",
    token,
  });
}

// Workflows

export function listAgentWorkflows(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<AgentWorkflowList> {
  return request<AgentWorkflowList>(base(workspaceId, "/workflows"), { token, signal });
}

export function createAgentWorkflow(
  token: string,
  workspaceId: string,
  body: AgentWorkflowRequest,
): Promise<AgentWorkflow> {
  return request<AgentWorkflow>(base(workspaceId, "/workflows"), { method: "POST", body, token });
}

export function updateAgentWorkflow(
  token: string,
  workspaceId: string,
  workflowId: string,
  body: AgentWorkflowRequest,
): Promise<AgentWorkflow> {
  return request<AgentWorkflow>(base(workspaceId, `/workflows/${id(workflowId)}`), {
    method: "PUT",
    body,
    token,
  });
}

export function setAgentWorkflowEnabled(
  token: string,
  workspaceId: string,
  workflowId: string,
  enabled: boolean,
): Promise<AgentWorkflow> {
  return request<AgentWorkflow>(base(workspaceId, `/workflows/${id(workflowId)}/enabled`), {
    method: "POST",
    body: { enabled },
    token,
  });
}

export function deleteAgentWorkflow(
  token: string,
  workspaceId: string,
  workflowId: string,
): Promise<void> {
  return request<void>(base(workspaceId, `/workflows/${id(workflowId)}`), {
    method: "DELETE",
    token,
  });
}

/** Queue a run now. The same `idempotencyKey` returns the same run instead of a second one. */
export function runAgentWorkflow(
  token: string,
  workspaceId: string,
  workflowId: string,
  idempotencyKey: string | null = null,
): Promise<AgentExecution> {
  return request<AgentExecution>(base(workspaceId, `/workflows/${id(workflowId)}/run`), {
    method: "POST",
    body: { idempotency_key: idempotencyKey },
    token,
  });
}

// Approvals

export function listAgentApprovals(
  token: string,
  workspaceId: string,
  status: readonly AgentApprovalStatus[] = [],
  { signal }: Signal = {},
): Promise<AgentApprovalList> {
  return request<AgentApprovalList>(base(workspaceId, `/approvals${toQueryString({ status })}`), {
    token,
    signal,
  });
}

/** Approve exactly the action shown: the server refuses it if its hash changed. */
export function approveAgentAction(
  token: string,
  workspaceId: string,
  approval: Pick<AgentApproval, "id" | "arguments_hash">,
): Promise<AgentApproval> {
  return request<AgentApproval>(base(workspaceId, `/approvals/${id(approval.id)}/approve`), {
    method: "POST",
    body: { arguments_hash: approval.arguments_hash },
    token,
  });
}

export function rejectAgentAction(
  token: string,
  workspaceId: string,
  approvalId: string,
): Promise<AgentApproval> {
  return request<AgentApproval>(base(workspaceId, `/approvals/${id(approvalId)}/reject`), {
    method: "POST",
    token,
  });
}

// Memory

export function listAgentMemories(
  token: string,
  workspaceId: string,
  category: AgentMemoryCategory | null = null,
  { signal }: Signal = {},
): Promise<AgentMemoryList> {
  return request<AgentMemoryList>(base(workspaceId, `/memories${toQueryString({ category })}`), {
    token,
    signal,
  });
}

export function addAgentMemory(
  token: string,
  workspaceId: string,
  content: string,
): Promise<AgentMemory> {
  return request<AgentMemory>(base(workspaceId, "/memories"), {
    method: "POST",
    body: { content },
    token,
  });
}

export function updateAgentMemory(
  token: string,
  workspaceId: string,
  memoryId: string,
  content: string,
): Promise<AgentMemory> {
  return request<AgentMemory>(base(workspaceId, `/memories/${id(memoryId)}`), {
    method: "PATCH",
    body: { content },
    token,
  });
}

export function deleteAgentMemory(
  token: string,
  workspaceId: string,
  memoryId: string,
): Promise<void> {
  return request<void>(base(workspaceId, `/memories/${id(memoryId)}`), {
    method: "DELETE",
    token,
  });
}
