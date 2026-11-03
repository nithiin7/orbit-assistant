import type {
  Backup,
  BackupInspection,
  BackupOverview,
  BackupUpload,
  RestoreReport,
} from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { BackupSettings } from "./backup-settings";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/backup",
  useSearchParams: () => new URLSearchParams(),
}));

const WS = `/api/v1/workspaces/${personal.id}`;

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

function backup(overrides: Partial<Backup> = {}): Backup {
  return {
    id: "b1",
    kind: "manual",
    status: "succeeded",
    include_files: true,
    encrypted: false,
    size_bytes: 2048,
    sha256: "a".repeat(64),
    record_count: 42,
    file_count: 3,
    modules: ["tasks", "notes"],
    record_counts: { tasks: 40, notes: 2 },
    warnings: [],
    error: null,
    format_version: 1,
    schema_revision: "0021",
    app_version: "0.1.0",
    started_at: "2026-11-03T09:00:00Z",
    finished_at: "2026-11-03T09:00:05Z",
    created_at: "2026-11-03T09:00:00Z",
    ...overrides,
  };
}

function overview(overrides: Partial<BackupOverview> = {}): BackupOverview {
  return {
    settings: {
      frequency: "manual",
      retention_count: 7,
      include_files: true,
      encrypt: false,
      has_backup_password: false,
      backup_password_set_at: null,
      next_run_at: null,
      last_run_at: null,
    },
    backups: [],
    uploads: [],
    total_bytes: 0,
    last_success_at: null,
    running: false,
    modules: [
      { module: "tasks", label: "Tasks", formats: ["json", "csv"] },
      { module: "calendar", label: "Calendar", formats: ["json", "ics"] },
    ],
    ...overrides,
  };
}

function staged(overrides: Partial<BackupUpload> = {}): BackupUpload {
  return {
    id: "u1",
    kind: "backup",
    encrypted: false,
    filename: "orbit-backup.zip",
    size_bytes: 4096,
    status: "uploaded",
    error: null,
    created_at: "2026-11-03T10:00:00Z",
    expires_at: "2026-11-04T10:00:00Z",
    finished_at: null,
    result: null,
    ...overrides,
  };
}

function report(overrides: Partial<RestoreReport> = {}): RestoreReport {
  return {
    dry_run: true,
    strategy: "new_workspace",
    workspace_id: "w-new",
    workspace_name: "Personal (restored)",
    remapped: 0,
    totals: { added: 42, duplicates: 0, matched: 0, skipped: 0 },
    tables: [],
    files_restored: 0,
    files_reused: 0,
    files_missing: 0,
    warnings: [],
    pre_restore_backup_id: null,
    ...overrides,
  };
}

function inspection(overrides: Partial<BackupInspection> = {}): BackupInspection {
  return {
    summary: {
      kind: "backup",
      format_version: 1,
      app_version: "0.1.0",
      schema_revision: "0021",
      created_at: "2026-11-01T08:00:00Z",
      source_workspace_name: "Personal",
      include_files: true,
      module_counts: { tasks: 40, notes: 2 },
      file_count: 3,
      file_bytes: 1024,
      missing_files: 0,
    },
    compatible: true,
    issues: [],
    warnings: [],
    target: { record_count: 10, has_integrations: false },
    dry_run: report(),
    ...overrides,
  };
}

function bodies(fetchMock: ReturnType<typeof mockApi>, method: string, path: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      return (init?.method ?? "GET") === method && url.pathname === path;
    })
    .map(([, init]) =>
      typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : init?.body,
    );
}

async function chooseFile(user: ReturnType<typeof userEvent.setup>, name = "orbit-backup.zip") {
  await user.upload(
    screen.getByLabelText("Backup or export file"),
    new File(["PK"], name, { type: "application/zip" }),
  );
}

beforeEach(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Backup & restore", () => {
  it("shows the overview and history, saying which backups are encrypted", async () => {
    mockApi({
      ...session,
      [`GET ${WS}/backups`]: json(
        overview({
          backups: [
            backup({ id: "b3", status: "failed", error: "The backup was interrupted." }),
            backup({ id: "b2", encrypted: true, kind: "scheduled" }),
            backup({ id: "b1" }),
          ],
          total_bytes: 4096,
          last_success_at: "2026-11-03T09:00:05Z",
        }),
      ),
    });
    await renderSignedIn(<BackupSettings />);
    expect(await screen.findByText("Last successful backup")).toBeInTheDocument();
    expect(
      screen.getByText(/The latest backup failed: The backup was interrupted/),
    ).toBeInTheDocument();
    const history = screen.getByRole("region", { name: "History" });
    expect(within(history).getByText("Encrypted")).toBeInTheDocument();
    expect(within(history).getByText("Not encrypted")).toBeInTheDocument();
    expect(within(history).getByText("Automatic")).toBeInTheDocument();
    expect(within(history).getAllByText("42 records · 3 files")).toHaveLength(2);
    expect(screen.getByText("Automatic backups are off.")).toBeInTheDocument();
  });

  it("explains an empty history and shows load errors", async () => {
    mockApi({ ...session, [`GET ${WS}/backups`]: json(overview()) });
    const { unmount } = await renderSignedIn(<BackupSettings />);
    expect(await screen.findByText(/No backups yet/)).toBeInTheDocument();
    unmount();

    mockApi({ ...session, [`GET ${WS}/backups`]: status(503) });
    await renderSignedIn(<BackupSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/database is unavailable/);
  });

  it("creates a password-protected backup after checking the passwords match", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...session,
      [`GET ${WS}/backups`]: json(overview()),
      [`POST ${WS}/backups`]: json(backup({ encrypted: true }), 201),
    });
    await renderSignedIn(<BackupSettings />);
    await user.click(await screen.findByRole("button", { name: "Create backup" }));
    const dialog = screen.getByRole("dialog", { name: "Create a backup" });
    await user.click(within(dialog).getByRole("combobox", { name: "Encryption" }));
    await user.click(screen.getByRole("option", { name: "A password for this backup" }));
    await user.type(within(dialog).getByLabelText("Password"), "a long backup password");
    await user.type(within(dialog).getByLabelText("Confirm password"), "something else entirely");
    await user.click(within(dialog).getByRole("button", { name: "Create backup" }));
    expect(await within(dialog).findByText("The passwords don’t match.")).toBeInTheDocument();
    expect(bodies(fetchMock, "POST", `${WS}/backups`)).toHaveLength(0);

    await user.clear(within(dialog).getByLabelText("Confirm password"));
    await user.type(within(dialog).getByLabelText("Confirm password"), "a long backup password");
    await user.click(within(dialog).getByRole("button", { name: "Create backup" }));
    await waitFor(() =>
      expect(bodies(fetchMock, "POST", `${WS}/backups`)).toEqual([
        { include_files: true, encryption: "password", password: "a long backup password" },
      ]),
    );
  });

  it("asks before deleting a backup", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...session,
      [`GET ${WS}/backups`]: json(overview({ backups: [backup()] })),
      [`DELETE ${WS}/backups/b1`]: status(204),
    });
    await renderSignedIn(<BackupSettings />);
    await user.click(await screen.findByRole("button", { name: /More for the backup/ }));
    await user.click(screen.getByRole("menuitem", { name: /Delete/ }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete this backup?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(bodies(fetchMock, "DELETE", `${WS}/backups/b1`)).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /More for the backup/ }));
    await user.click(screen.getByRole("menuitem", { name: /Delete/ }));
    await user.click(screen.getByRole("button", { name: "Delete backup" }));
    await waitFor(() => expect(bodies(fetchMock, "DELETE", `${WS}/backups/b1`)).toHaveLength(1));
  });

  it("replaces a workspace only after its name is typed and the action confirmed", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...session,
      [`GET ${WS}/backups`]: json(overview()),
      [`POST ${WS}/backup-uploads`]: json(staged(), 201),
      [`POST ${WS}/backup-uploads/u1/inspect`]: json(inspection()),
      [`POST ${WS}/backup-uploads/u1/restore`]: json(
        report({
          dry_run: false,
          strategy: "replace",
          workspace_id: personal.id,
          workspace_name: personal.name,
          files_restored: 3,
          pre_restore_backup_id: "b9",
        }),
      ),
    });
    await renderSignedIn(<BackupSettings />);
    await screen.findByText(/No backups yet/);
    await chooseFile(user);
    expect(await screen.findByText(/42 records to add/)).toBeInTheDocument();
    expect(screen.getByText("tasks · 40")).toBeInTheDocument();
    // The workspace has records, so restoring "into" it isn't offered.
    expect(screen.getByRole("radio", { name: /Restore into this workspace/ })).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: /Replace this workspace’s data/ }));
    const replace = screen.getByRole("button", { name: "Replace data" });
    expect(replace).toBeDisabled();
    await user.type(screen.getByLabelText(`Type “${personal.name}” to confirm`), personal.name);
    await user.click(replace);
    const dialog = screen.getByRole("alertdialog", { name: /Replace everything/ });
    await user.click(within(dialog).getByRole("button", { name: "Replace data" }));

    expect(await screen.findByText(/Restored into/)).toBeInTheDocument();
    expect(screen.getByText(/“Before restore” backup/)).toBeInTheDocument();
    expect(bodies(fetchMock, "POST", `${WS}/backup-uploads/u1/restore`)).toEqual([
      {
        strategy: "replace",
        password: null,
        workspace_name: null,
        confirm_name: personal.name,
        allow_repeat: false,
        dry_run: false,
      },
    ]);
  });

  it("asks for the password of an encrypted backup and shows when it's wrong", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const fetchMock = mockApi({
      ...session,
      [`GET ${WS}/backups`]: json(overview()),
      [`POST ${WS}/backup-uploads`]: json(staged({ encrypted: true }), 201),
      [`POST ${WS}/backup-uploads/u1/inspect`]: () => {
        attempts += 1;
        return attempts === 1
          ? Response.json({ detail: "That password doesn't open this backup." }, { status: 422 })
          : Response.json(inspection());
      },
    });
    await renderSignedIn(<BackupSettings />);
    await screen.findByText(/No backups yet/);
    await chooseFile(user, "b.orbit-backup");
    await user.type(await screen.findByLabelText("Backup password"), "wrong password");
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("That password doesn't open this backup.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Backup password"));
    await user.type(screen.getByLabelText("Backup password"), "right password");
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText(/Dry run:/)).toBeInTheDocument();
    expect(bodies(fetchMock, "POST", `${WS}/backup-uploads/u1/inspect`).at(-1)).toEqual({
      password: "right password",
    });
  });

  it("imports an export into this workspace", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...session,
      [`GET ${WS}/backups`]: json(overview()),
      [`POST ${WS}/backup-uploads`]: json(staged({ kind: "export", filename: "tasks.json" }), 201),
      [`POST ${WS}/backup-uploads/u1/inspect`]: json(
        inspection({
          summary: { ...inspection().summary, kind: "export" },
          dry_run: report({
            strategy: "merge",
            totals: { added: 2, duplicates: 5, matched: 0, skipped: 1 },
          }),
        }),
      ),
      [`POST ${WS}/backup-uploads/u1/restore`]: json(
        report({
          dry_run: false,
          strategy: "merge",
          workspace_id: personal.id,
          workspace_name: personal.name,
        }),
      ),
    });
    await renderSignedIn(<BackupSettings />);
    await screen.findByText(/No backups yet/);
    await chooseFile(user, "tasks.json");
    expect(await screen.findByText(/5 already here/)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import records" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Import" }),
    );
    expect(await screen.findByText(/Imported into/)).toBeInTheDocument();
    expect(bodies(fetchMock, "POST", `${WS}/backup-uploads/u1/restore`)[0]).toMatchObject({
      strategy: null,
    });
  });

  it("shows why a file can't be restored and offers nothing to confirm", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      [`GET ${WS}/backups`]: json(overview()),
      [`POST ${WS}/backup-uploads`]: json(staged(), 201),
      [`POST ${WS}/backup-uploads/u1/inspect`]: json(
        inspection({
          compatible: false,
          issues: ["This file was made by a newer version of Orbit. Update Orbit to restore it."],
          dry_run: null,
        }),
      ),
    });
    await renderSignedIn(<BackupSettings />);
    await screen.findByText(/No backups yet/);
    await chooseFile(user);
    expect(await screen.findByText(/newer version of Orbit/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeDisabled();
  });

  it("reports upload failures", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      [`GET ${WS}/backups`]: json(overview()),
      [`POST ${WS}/backup-uploads`]: () =>
        Response.json(
          { detail: "This archive isn't an Orbit backup: it has no manifest." },
          { status: 422 },
        ),
    });
    await renderSignedIn(<BackupSettings />);
    await screen.findByText(/No backups yet/);
    await chooseFile(user);
    expect(await screen.findByText(/has no manifest/)).toBeInTheDocument();
  });

  it("needs a backup password before encrypting automatic backups", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...session,
      [`GET ${WS}/backups`]: json(overview()),
      [`PUT ${WS}/backups/settings`]: json({
        ...overview().settings,
        frequency: "daily",
        encrypt: true,
        has_backup_password: true,
      }),
    });
    await renderSignedIn(<BackupSettings />);
    const schedule = await screen.findByRole("region", { name: "Automatic backups" });
    await user.click(within(schedule).getByRole("combobox", { name: "Frequency" }));
    await user.click(screen.getByRole("option", { name: "Every day" }));
    await user.click(
      within(schedule).getByRole("checkbox", { name: /Encrypt with a backup password/ }),
    );
    await user.click(within(schedule).getByRole("button", { name: "Save" }));
    expect(await within(schedule).findByText(/Choose a backup password/)).toBeInTheDocument();
    expect(bodies(fetchMock, "PUT", `${WS}/backups/settings`)).toHaveLength(0);

    await user.type(within(schedule).getByLabelText("Backup password"), "a long backup password");
    await user.type(within(schedule).getByLabelText("Confirm password"), "a long backup password");
    await user.click(within(schedule).getByRole("button", { name: "Save" }));
    expect(await within(schedule).findByText("Saved.")).toBeInTheDocument();
    expect(bodies(fetchMock, "PUT", `${WS}/backups/settings`)).toEqual([
      {
        frequency: "daily",
        retention_count: 7,
        include_files: true,
        encrypt: true,
        password: "a long backup password",
      },
    ]);
  });

  it("exports a module in the chosen format", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...session,
      [`GET ${WS}/backups`]: json(overview()),
      [`POST ${WS}/exports`]: () =>
        new Response("BEGIN:VCALENDAR", {
          headers: { "Content-Disposition": "attachment; filename*=UTF-8''orbit-calendar.ics" },
        }),
    });
    await renderSignedIn(<BackupSettings />);
    await user.click(
      await screen.findByRole("button", { name: "Export Calendar as Calendar (.ics)" }),
    );
    await waitFor(() =>
      expect(bodies(fetchMock, "POST", `${WS}/exports`)).toEqual([
        { module: "calendar", format: "ics" },
      ]),
    );
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});
