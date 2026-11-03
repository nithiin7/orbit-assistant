import type { RestoreReport } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  backupSettingsSchema,
  createBackupSchema,
  describeContents,
  scheduleSummary,
  summarizeReport,
} from "./backups";

function report(overrides: Partial<RestoreReport> = {}): RestoreReport {
  return {
    dry_run: false,
    strategy: "new_workspace",
    workspace_id: "w2",
    workspace_name: "Home (restored)",
    remapped: 0,
    totals: { added: 12, duplicates: 0, matched: 0, skipped: 0 },
    tables: [],
    files_restored: 2,
    files_reused: 0,
    files_missing: 0,
    warnings: [],
    pre_restore_backup_id: null,
    ...overrides,
  };
}

describe("backup display", () => {
  it("describes contents and schedules", () => {
    expect(describeContents({ record_count: 1, file_count: 2, include_files: true })).toBe(
      "1 record · 2 files",
    );
    expect(describeContents({ record_count: 3, file_count: 0, include_files: false })).toBe(
      "3 records · no files",
    );
    expect(
      scheduleSummary({
        frequency: "manual",
        retention_count: 7,
        include_files: true,
        encrypt: false,
        has_backup_password: false,
        backup_password_set_at: null,
        next_run_at: null,
        last_run_at: null,
      }),
    ).toBe("Automatic backups are off.");
  });

  it("summarizes restore reports and dry runs", () => {
    expect(summarizeReport(report())).toBe("12 records added · 2 files");
    expect(
      summarizeReport(
        report({
          dry_run: true,
          files_restored: 0,
          totals: { added: 1, duplicates: 4, matched: 2, skipped: 1 },
        }),
      ),
    ).toBe("1 record to add · 4 already here · 2 matched to existing ones · 1 left out");
  });
});

describe("backup forms", () => {
  it("needs a confirmed password only when encrypting with one", async () => {
    const valid = { includeFiles: true, encryption: "none", password: "", confirm: "" };
    await expect(createBackupSchema.isValid(valid)).resolves.toBe(true);
    await expect(
      createBackupSchema.isValid({ ...valid, encryption: "password", password: "short" }),
    ).resolves.toBe(false);
    await expect(
      createBackupSchema.isValid({
        ...valid,
        encryption: "password",
        password: "long enough password",
        confirm: "different password",
      }),
    ).resolves.toBe(false);
    await expect(
      createBackupSchema.isValid({
        ...valid,
        encryption: "password",
        password: "long enough password",
        confirm: "long enough password",
      }),
    ).resolves.toBe(true);
  });

  it("bounds retention and checks a new backup password", async () => {
    const valid = {
      frequency: "daily",
      retention: 7,
      includeFiles: true,
      encrypt: false,
      password: "",
      confirm: "",
    };
    await expect(backupSettingsSchema.isValid(valid)).resolves.toBe(true);
    await expect(backupSettingsSchema.isValid({ ...valid, retention: 0 })).resolves.toBe(false);
    await expect(backupSettingsSchema.isValid({ ...valid, retention: 51 })).resolves.toBe(false);
    await expect(
      backupSettingsSchema.isValid({ ...valid, password: "short", confirm: "short" }),
    ).resolves.toBe(false);
  });
});
