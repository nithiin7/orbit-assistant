import type { IntegrationSyncRun } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  capabilityName,
  connectionHref,
  formatFileSize,
  formatSynced,
  linkedRecordHref,
  rememberConnectReturn,
  runStatusLabel,
  runSummary,
  takeConnectReturn,
} from "./integrations";

function run(overrides: Partial<IntegrationSyncRun> = {}): IntegrationSyncRun {
  return {
    id: "r1",
    resource_id: "c1",
    kind: "calendar",
    trigger: "manual",
    status: "succeeded",
    full: false,
    imported: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    conflicts: 0,
    exported: 0,
    failed: 0,
    error: null,
    attempts: 0,
    next_attempt_at: null,
    started_at: null,
    finished_at: null,
    created_at: "2030-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("integration helpers", () => {
  it("names capabilities the way each provider does", () => {
    expect(capabilityName("google", "mail")).toBe("Gmail");
    expect(capabilityName("microsoft", "files")).toBe("OneDrive");
  });

  it("summarizes a run without zeros", () => {
    expect(runSummary(run({ imported: 3, updated: 1, conflicts: 1 }))).toBe(
      "3 added, 1 updated, 1 conflict",
    );
    expect(runSummary(run())).toBe("Up to date");
    expect(runSummary(run({ status: "failed" }))).toBe("");
  });

  it("says when a run will be retried", () => {
    expect(runStatusLabel(run({ status: "queued", attempts: 2 }))).toBe("Retrying soon");
    expect(runStatusLabel(run({ status: "partial" }))).toBe("Done with problems");
  });

  it("says how long ago a sync was", () => {
    const now = new Date("2030-01-01T12:00:00Z");
    expect(formatSynced(null, now)).toBe("Not yet");
    expect(formatSynced("2030-01-01T11:59:50Z", now)).toBe("Just now");
    expect(formatSynced("2030-01-01T11:48:00Z", now)).toBe("12 min ago");
    expect(formatSynced("2030-01-01T09:00:00Z", now)).toBe("3 h ago");
  });

  it("formats sizes and links", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(3_500_000)).toBe("3.3 MB");
    expect(formatFileSize(null)).toBe("");
    expect(linkedRecordHref("task", "t1")).toBe("/tasks?task=t1");
    expect(linkedRecordHref("reminder", "r1")).toBe("/reminders");
    expect(connectionHref("a b")).toBe("/settings/integrations?connection=a%20b");
  });
});

describe("connect return path", () => {
  it("returns a remembered same-origin path once", () => {
    rememberConnectReturn("/welcome?step=connect");
    expect(takeConnectReturn()).toBe("/welcome?step=connect");
    expect(takeConnectReturn()).toBeNull();
  });

  it("ignores other origins and can be forgotten", () => {
    rememberConnectReturn("//evil.example");
    expect(takeConnectReturn()).toBeNull();
    rememberConnectReturn("/welcome");
    rememberConnectReturn(null);
    expect(takeConnectReturn()).toBeNull();
  });
});
