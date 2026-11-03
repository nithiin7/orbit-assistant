import { afterEach, describe, expect, it, vi } from "vitest";

import {
  approveAgentAction,
  changeAgentExecution,
  listAgentApprovals,
  listAgentExecutions,
  runAgentWorkflow,
  startAgentRun,
  updateAgent,
} from "./requests";

const API = "http://localhost:8000/api/v1";
const AGENT = `${API}/workspaces/w1/agent`;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub() {
  const fetchMock = vi.fn(() => Promise.resolve(Response.json({})));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function call(fetchMock: ReturnType<typeof stub>, index = 0): [string, RequestInit] {
  return fetchMock.mock.calls[index] as unknown as [string, RequestInit];
}

describe("agent requests", () => {
  it("approves with the hash of the exact action reviewed", async () => {
    const fetchMock = stub();
    await approveAgentAction("token", "w1", { id: "a/1", arguments_hash: "h".repeat(64) });
    const [url, init] = call(fetchMock);
    expect(url).toBe(`${AGENT}/approvals/a%2F1/approve`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ arguments_hash: "h".repeat(64) });
    expect(init.headers).toMatchObject({ Authorization: "Bearer token" });
  });

  it("filters history and approvals by repeated status parameters", async () => {
    const fetchMock = stub();
    await listAgentExecutions("token", "w1", { status: ["failed", "cancelled"], limit: 10 });
    await listAgentApprovals("token", "w1", ["pending"]);
    expect(call(fetchMock)[0]).toBe(`${AGENT}/executions?status=failed&status=cancelled&limit=10`);
    expect(call(fetchMock, 1)[0]).toBe(`${AGENT}/approvals?status=pending`);
  });

  it("starts runs with an idempotency key and changes them by action", async () => {
    const fetchMock = stub();
    await startAgentRun("token", "w1", { goal: "Plan my day", idempotency_key: "k1" });
    await runAgentWorkflow("token", "w1", "wf1", "k2");
    await changeAgentExecution("token", "w1", "e1", "retry");
    await updateAgent("token", "w1", { autonomy: "suggest" });
    expect(call(fetchMock)[0]).toBe(`${AGENT}/runs`);
    expect(JSON.parse(String(call(fetchMock)[1].body))).toEqual({
      goal: "Plan my day",
      idempotency_key: "k1",
    });
    expect(call(fetchMock, 1)[0]).toBe(`${AGENT}/workflows/wf1/run`);
    expect(JSON.parse(String(call(fetchMock, 1)[1].body))).toEqual({ idempotency_key: "k2" });
    expect(call(fetchMock, 2)[0]).toBe(`${AGENT}/executions/e1/retry`);
    expect(call(fetchMock, 3)[1].method).toBe("PATCH");
  });
});
