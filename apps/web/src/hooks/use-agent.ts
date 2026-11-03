"use client";

import type {
  Agent,
  AgentApproval,
  AgentApprovalList,
  AgentApprovalStatus,
  AgentExecution,
  AgentExecutionDetail,
  AgentExecutionList,
  AgentMemory,
  AgentMemoryList,
  AgentOverview,
  AgentToolList,
  AgentWorkflow,
  AgentWorkflowList,
  AgentWorkflowRequest,
  UpdateAgentRequest,
} from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ACTIVE_REFRESH_MS,
  addAgentMemory,
  agentApprovalsOptions,
  agentExecutionOptions,
  agentExecutionsOptions,
  agentKeys,
  agentMemoriesOptions,
  agentOverviewOptions,
  agentToolsOptions,
  agentWorkflowsOptions,
  approveAgentAction,
  changeAgentExecution,
  createAgentWorkflow,
  deleteAgentMemory,
  deleteAgentWorkflow,
  type ExecutionQuery,
  rejectAgentAction,
  runAgentWorkflow,
  setAgentWorkflowEnabled,
  startAgentRun,
  updateAgent,
  updateAgentMemory,
  updateAgentWorkflow,
} from "@/api/agent";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { ACTIVE_STATUSES, hasActive } from "@/lib/agent";
import { useAuth } from "@/providers/auth";

function useWorkspace() {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  return { withToken, workspaceId };
}

/** Marks the agent's views stale; an action that ran may have changed any module. */
function useInvalidate(everything = false) {
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  return () =>
    queryClient.invalidateQueries({
      queryKey: everything ? ["workspaces", workspaceId] : agentKeys.all(workspaceId),
    });
}

// Reads

export function useAgentOverview(): Resource<AgentOverview> {
  const { withToken, workspaceId } = useWorkspace();
  const result = useQuery({
    ...agentOverviewOptions(withToken, workspaceId),
    refetchInterval: (query) =>
      query.state.data && (hasActive(query.state.data.recent) || query.state.data.pending_approvals)
        ? ACTIVE_REFRESH_MS
        : false,
  });
  useWorkspaceNotFound(result.error);
  return queryResource(result, "Couldn’t load the agent.");
}

export function useAgentTools(): Resource<AgentToolList> {
  const { withToken, workspaceId } = useWorkspace();
  return queryResource(
    useQuery(agentToolsOptions(withToken, workspaceId)),
    "Couldn’t load the agent’s tools.",
  );
}

export function useAgentWorkflows(): Resource<AgentWorkflowList> {
  const { withToken, workspaceId } = useWorkspace();
  return queryResource(
    useQuery(agentWorkflowsOptions(withToken, workspaceId)),
    "Couldn’t load workflows.",
  );
}

export function useAgentExecutions(query: ExecutionQuery = {}): Resource<AgentExecutionList> {
  const { withToken, workspaceId } = useWorkspace();
  return queryResource(
    useQuery({
      ...agentExecutionsOptions(withToken, workspaceId, query),
      refetchInterval: (q) =>
        q.state.data && hasActive(q.state.data.executions) ? ACTIVE_REFRESH_MS : false,
    }),
    "Couldn’t load activity.",
  );
}

export function useAgentExecution(executionId: string | null): Resource<AgentExecutionDetail> {
  const { withToken, workspaceId } = useWorkspace();
  return queryResource(
    useQuery({
      ...agentExecutionOptions(withToken, workspaceId, executionId),
      refetchInterval: (q) =>
        q.state.data && ACTIVE_STATUSES.has(q.state.data.execution.status)
          ? ACTIVE_REFRESH_MS
          : false,
    }),
    "Couldn’t load this run.",
  );
}

export function useAgentApprovals(
  status: readonly AgentApprovalStatus[] = [],
): Resource<AgentApprovalList> {
  const { withToken, workspaceId } = useWorkspace();
  return queryResource(
    useQuery(agentApprovalsOptions(withToken, workspaceId, status)),
    "Couldn’t load approvals.",
  );
}

export function useAgentMemories(): Resource<AgentMemoryList> {
  const { withToken, workspaceId } = useWorkspace();
  return queryResource(
    useQuery(agentMemoriesOptions(withToken, workspaceId)),
    "Couldn’t load what the agent remembers.",
  );
}

// Changes

function requireWorkspace(workspaceId: string | null): string {
  if (workspaceId === null) throw new Error("No workspace is selected.");
  return workspaceId;
}

export function useUpdateAgent() {
  const { withToken, workspaceId } = useWorkspace();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: UpdateAgentRequest): Promise<Agent> =>
      withToken((token) => updateAgent(token, requireWorkspace(workspaceId), body)),
    onSuccess: invalidate,
  });
}

export function useStartAgentRun() {
  const { withToken, workspaceId } = useWorkspace();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ goal, key }: { goal: string; key: string }): Promise<AgentExecution> =>
      withToken((token) =>
        startAgentRun(token, requireWorkspace(workspaceId), { goal, idempotency_key: key }),
      ),
    onSuccess: invalidate,
  });
}

export function useSaveWorkflow() {
  const { withToken, workspaceId } = useWorkspace();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string | null;
      body: AgentWorkflowRequest;
    }): Promise<AgentWorkflow> =>
      withToken((token) => {
        const ws = requireWorkspace(workspaceId);
        return id === null
          ? createAgentWorkflow(token, ws, body)
          : updateAgentWorkflow(token, ws, id, body);
      }),
    onSuccess: invalidate,
  });
}

export function useWorkflowActions() {
  const { withToken, workspaceId } = useWorkspace();
  const invalidate = useInvalidate();
  const setEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      withToken((token) =>
        setAgentWorkflowEnabled(token, requireWorkspace(workspaceId), id, enabled),
      ),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      withToken((token) => deleteAgentWorkflow(token, requireWorkspace(workspaceId), id)),
    onSuccess: invalidate,
  });
  const run = useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) =>
      withToken((token) => runAgentWorkflow(token, requireWorkspace(workspaceId), id, key)),
    onSuccess: invalidate,
  });
  return { setEnabled, remove, run };
}

export function useDecideApproval() {
  const { withToken, workspaceId } = useWorkspace();
  // An approved action may have created or changed records in any module.
  const invalidate = useInvalidate(true);
  return useMutation({
    mutationFn: ({
      approval,
      decision,
    }: {
      approval: AgentApproval;
      decision: "approve" | "reject";
    }): Promise<AgentApproval> =>
      withToken((token) => {
        const ws = requireWorkspace(workspaceId);
        return decision === "approve"
          ? approveAgentAction(token, ws, approval)
          : rejectAgentAction(token, ws, approval.id);
      }),
    onSuccess: invalidate,
  });
}

export function useChangeExecution() {
  const { withToken, workspaceId } = useWorkspace();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "cancel" | "retry" }) =>
      withToken((token) => changeAgentExecution(token, requireWorkspace(workspaceId), id, action)),
    onSuccess: invalidate,
  });
}

export function useMemoryActions() {
  const { withToken, workspaceId } = useWorkspace();
  const invalidate = useInvalidate();
  const add = useMutation({
    mutationFn: (content: string): Promise<AgentMemory> =>
      withToken((token) => addAgentMemory(token, requireWorkspace(workspaceId), content)),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }): Promise<AgentMemory> =>
      withToken((token) => updateAgentMemory(token, requireWorkspace(workspaceId), id, content)),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      withToken((token) => deleteAgentMemory(token, requireWorkspace(workspaceId), id)),
    onSuccess: invalidate,
  });
  return { add, update, remove };
}
