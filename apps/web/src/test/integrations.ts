import type {
  IntegrationCalendar,
  IntegrationConnection,
  IntegrationConnectionDetail,
  IntegrationProvider,
  IntegrationSyncRun,
} from "@orbit/contracts";

import { personal } from "./api-mock";

/** Fixtures for integration views: one Google connection with a calendar, and providers. */
export const INTEGRATIONS = `/api/v1/workspaces/${personal.id}/integrations`;

export const google: IntegrationProvider = {
  provider: "google",
  name: "Google",
  configured: true,
  capabilities: [
    { capability: "calendar", purpose: "Read your calendars.", scopes: ["cal.read"] },
    { capability: "calendar_write", purpose: "Change events.", scopes: ["cal.write"] },
    {
      capability: "mail",
      purpose: "Read chosen labels. Orbit never sends mail.",
      scopes: ["mail"],
    },
    { capability: "files", purpose: "Browse and import files.", scopes: ["files"] },
  ],
};

export const microsoft: IntegrationProvider = {
  provider: "microsoft",
  name: "Microsoft",
  configured: false,
  capabilities: [],
};

export function connection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: "c1",
    workspace_id: personal.id,
    provider: "google",
    account_email: "ada@gmail.example",
    display_name: "Ada",
    capabilities: ["calendar", "mail", "files"],
    scopes: ["cal.read", "mail", "files"],
    status: "active",
    mail_days: 30,
    last_synced_at: null,
    last_error: null,
    created_at: "2030-01-01T00:00:00Z",
    ...overrides,
  };
}

export function calendar(overrides: Partial<IntegrationCalendar> = {}): IntegrationCalendar {
  return {
    id: "r1",
    kind: "calendar",
    external_id: "primary",
    name: "Personal",
    enabled: false,
    writable: true,
    direction: "import",
    sync_interval_minutes: 60,
    category_id: null,
    timezone: "Europe/London",
    last_synced_at: null,
    next_sync_at: null,
    last_error: null,
    push: false,
    ...overrides,
  };
}

export function run(overrides: Partial<IntegrationSyncRun> = {}): IntegrationSyncRun {
  return {
    id: "run1",
    resource_id: "r1",
    kind: "calendar",
    trigger: "manual",
    status: "succeeded",
    full: true,
    imported: 3,
    updated: 0,
    deleted: 0,
    skipped: 0,
    conflicts: 0,
    exported: 0,
    failed: 0,
    error: null,
    attempts: 0,
    next_attempt_at: null,
    started_at: "2030-01-01T00:00:00Z",
    finished_at: "2030-01-01T00:01:00Z",
    created_at: "2030-01-01T00:00:00Z",
    ...overrides,
  };
}

export function detail(
  overrides: Partial<IntegrationConnectionDetail> = {},
): IntegrationConnectionDetail {
  return {
    connection: connection(),
    resources: [calendar()],
    runs: [],
    conflicts: 0,
    imported_files: 0,
    ...overrides,
  };
}
