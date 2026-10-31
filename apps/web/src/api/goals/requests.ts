import type {
  CreateContributionRequest,
  CreateGoalRequest,
  GoalContribution,
  GoalContributionList,
  SavingsGoal,
  SavingsGoalList,
  UpdateGoalRequest,
} from "@orbit/contracts";

import { request, type Signal, toQueryString, workspacePath } from "../client";

function goalsPath(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/finance/savings-goals${suffix}`);
}

function goalPath(workspaceId: string, goalId: string, suffix = ""): string {
  return goalsPath(workspaceId, `/${encodeURIComponent(goalId)}${suffix}`);
}

export function listGoals(
  token: string,
  workspaceId: string,
  today: string,
  { signal }: Signal = {},
): Promise<SavingsGoalList> {
  return request<SavingsGoalList>(`${goalsPath(workspaceId)}${toQueryString({ today })}`, {
    token,
    signal,
  });
}

export function createGoal(
  token: string,
  workspaceId: string,
  body: CreateGoalRequest,
): Promise<SavingsGoal> {
  return request<SavingsGoal>(goalsPath(workspaceId), { method: "POST", body, token });
}

export function updateGoal(
  token: string,
  workspaceId: string,
  goalId: string,
  body: UpdateGoalRequest,
): Promise<SavingsGoal> {
  return request<SavingsGoal>(goalPath(workspaceId, goalId), { method: "PATCH", body, token });
}

export function deleteGoal(token: string, workspaceId: string, goalId: string) {
  return request<void>(goalPath(workspaceId, goalId), { method: "DELETE", token });
}

export function listContributions(
  token: string,
  workspaceId: string,
  goalId: string,
  { signal }: Signal = {},
): Promise<GoalContributionList> {
  return request<GoalContributionList>(goalPath(workspaceId, goalId, "/contributions"), {
    token,
    signal,
  });
}

export function createContribution(
  token: string,
  workspaceId: string,
  goalId: string,
  body: CreateContributionRequest,
): Promise<GoalContribution> {
  return request<GoalContribution>(goalPath(workspaceId, goalId, "/contributions"), {
    method: "POST",
    body,
    token,
  });
}

export function deleteContribution(
  token: string,
  workspaceId: string,
  goalId: string,
  contributionId: string,
  deleteTransaction: boolean,
) {
  return request<void>(
    `${goalPath(workspaceId, goalId, `/contributions/${encodeURIComponent(contributionId)}`)}${toQueryString(
      { delete_transaction: deleteTransaction },
    )}`,
    { method: "DELETE", token },
  );
}
