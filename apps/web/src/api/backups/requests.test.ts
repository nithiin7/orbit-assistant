import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachmentName,
  createBackup,
  deleteBackup,
  downloadBackup,
  exportModule,
  inspectUpload,
  restoreUpload,
  uploadBackup,
} from "./requests";

const API = "http://localhost:8000/api/v1/workspaces/w1";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub(response: () => Response = () => Response.json({})) {
  const fetchMock = vi.fn(() => Promise.resolve(response()));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function call(fetchMock: ReturnType<typeof stub>, index = 0): [string, RequestInit] {
  return fetchMock.mock.calls[index] as unknown as [string, RequestInit];
}

describe("backup requests", () => {
  it("sends passwords in the body, never the URL", async () => {
    const fetchMock = stub();
    await createBackup("token", "w1", {
      include_files: true,
      encryption: "password",
      password: "a long password",
    });
    await inspectUpload("token", "w1", "u 1", { password: "secret value" });
    await restoreUpload("token", "w1", "u1", {
      strategy: "new_workspace",
      password: "secret value",
      workspace_name: null,
      confirm_name: null,
      allow_repeat: false,
      dry_run: false,
    });
    expect(call(fetchMock)[0]).toBe(`${API}/backups`);
    expect(call(fetchMock, 1)[0]).toBe(`${API}/backup-uploads/u%201/inspect`);
    expect(call(fetchMock, 2)[0]).toBe(`${API}/backup-uploads/u1/restore`);
    for (const [url] of fetchMock.mock.calls as unknown as [string][]) {
      expect(url).not.toContain("secret");
      expect(url).not.toContain("password");
    }
  });

  it("uploads the raw file with its name", async () => {
    const fetchMock = stub();
    await uploadBackup(
      "token",
      "w1",
      new File(["PK"], "my backup.zip", { type: "application/zip" }),
    );
    const [url, init] = call(fetchMock);
    expect(url).toBe(`${API}/backup-uploads?filename=my+backup.zip`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/octet-stream" });
  });

  it("downloads with the token and keeps the server's file name", async () => {
    const fetchMock = stub(
      () =>
        new Response("zip", {
          headers: {
            "Content-Disposition": "attachment; filename*=UTF-8''orbit-backup-2026-11-03.zip",
          },
        }),
    );
    const file = await downloadBackup("token", "w1", "b1");
    expect(file.filename).toBe("orbit-backup-2026-11-03.zip");
    expect(call(fetchMock)[1].headers).toMatchObject({ Authorization: "Bearer token" });
    await exportModule("token", "w1", { module: "calendar", format: "ics" });
    expect(call(fetchMock, 1)[0]).toBe(`${API}/exports`);
  });

  it("deletes a backup", async () => {
    const fetchMock = stub(() => new Response(null, { status: 204 }));
    await deleteBackup("token", "w1", "b1");
    expect(call(fetchMock)).toEqual([
      `${API}/backups/b1`,
      expect.objectContaining({ method: "DELETE" }),
    ]);
  });

  it("falls back when there's no usable file name", () => {
    expect(attachmentName(new Response(""), "fallback.zip")).toBe("fallback.zip");
    const bad = new Response("", {
      headers: { "Content-Disposition": "attachment; filename*=UTF-8''%E0" },
    });
    expect(attachmentName(bad, "fallback.zip")).toBe("fallback.zip");
  });
});
