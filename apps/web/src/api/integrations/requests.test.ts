import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authorizeIntegration,
  completeAuthorization,
  createFromMessage,
  disconnect,
  listMessages,
  listOrigins,
  listRemoteFiles,
  syncNow,
} from "./requests";

const API = "http://localhost:8000/api/v1";
const WS = `${API}/workspaces/w1/integrations`;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub() {
  // A fresh response per call: a body can be read only once.
  const fetchMock = vi.fn(() => Promise.resolve(Response.json({})));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function call(fetchMock: ReturnType<typeof stub>, index = 0): [string, RequestInit] {
  return fetchMock.mock.calls[index] as unknown as [string, RequestInit];
}

describe("integration requests", () => {
  it("starts authorization in the workspace and completes it outside, with the session", async () => {
    const fetchMock = stub();
    await authorizeIntegration("token", "w1", { provider: "google", capabilities: ["calendar"] });
    await completeAuthorization("token", { state: "s", code: "c", error: null });
    const [first, init] = call(fetchMock);
    expect(first).toBe(`${WS}/authorize`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer token" });
    expect(call(fetchMock, 1)[0]).toBe(`${API}/integrations/oauth/complete`);
  });

  it("disconnects, removing imported records only when asked", async () => {
    const fetchMock = stub();
    await disconnect("token", "w1", "c 1", false);
    await disconnect("token", "w1", "c1", true);
    expect(call(fetchMock)[0]).toBe(`${WS}/connections/c%201`);
    expect(call(fetchMock, 1)[0]).toBe(`${WS}/connections/c1?remove_imported=true`);
    expect(call(fetchMock).at(1)).toMatchObject({ method: "DELETE" });
  });

  it("queues a sync for one calendar or everything", async () => {
    const fetchMock = stub();
    await syncNow("token", "w1", "c1");
    await syncNow("token", "w1", "c1", "r1");
    expect(JSON.parse(call(fetchMock)[1].body as string)).toEqual({ resource_id: null });
    expect(JSON.parse(call(fetchMock, 1)[1].body as string)).toEqual({ resource_id: "r1" });
  });

  it("encodes mail, file, and origin queries", async () => {
    const fetchMock = stub();
    await listMessages("token", "w1", "c1", { labelId: "INBOX", search: "a&b" });
    await listRemoteFiles("token", "w1", "c1", { folderId: "f/1" });
    await listOrigins("token", "w1", "event", "e1");
    expect(call(fetchMock)[0]).toBe(`${WS}/connections/c1/mail/messages?label_id=INBOX&q=a%26b`);
    expect(call(fetchMock, 1)[0]).toBe(`${WS}/connections/c1/files?folder_id=f%2F1`);
    expect(call(fetchMock, 2)[0]).toBe(`${WS}/origins?entity_type=event&entity_id=e1`);
  });

  it("creates records from a message at the record's own path", async () => {
    const fetchMock = stub();
    await createFromMessage("token", "w1", "c1", "m/1", {
      kind: "task",
      body: { title: "Pay" },
    });
    const [url, init] = call(fetchMock);
    expect(url).toBe(`${WS}/connections/c1/mail/messages/m%2F1/task`);
    expect(JSON.parse(init.body as string)).toEqual({ title: "Pay" });
  });
});
