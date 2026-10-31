import type {
  Currency,
  MonthlyIncomePlan,
  MonthPlan,
  PlanQuery,
  SetIncomeRequest,
} from "@orbit/contracts";

import { request, type Signal, toQueryString, workspacePath } from "../client";

function planPath(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/finance/plan${suffix}`);
}

export function getPlan(
  token: string,
  workspaceId: string,
  query: PlanQuery,
  { signal }: Signal = {},
): Promise<MonthPlan> {
  return request<MonthPlan>(`${planPath(workspaceId)}${toQueryString(query)}`, { token, signal });
}

export function setExpectedIncome(
  token: string,
  workspaceId: string,
  month: string,
  body: SetIncomeRequest,
): Promise<MonthlyIncomePlan> {
  return request<MonthlyIncomePlan>(planPath(workspaceId, `/${encodeURIComponent(month)}`), {
    method: "PUT",
    body,
    token,
  });
}

export function clearExpectedIncome(
  token: string,
  workspaceId: string,
  month: string,
  currency: Currency,
) {
  return request<void>(
    `${planPath(workspaceId, `/${encodeURIComponent(month)}`)}${toQueryString({ currency })}`,
    { method: "DELETE", token },
  );
}
