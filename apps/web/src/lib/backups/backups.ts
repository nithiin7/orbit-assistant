/** Backup display rules and form schemas that mirror the API's. */

import type {
  Backup,
  BackupEncryption,
  BackupFrequency,
  BackupKind,
  BackupSettings,
  BackupUploadStatus,
  ExportFormat,
  RestoreReport,
  RestoreStrategy,
} from "@orbit/contracts";
import { boolean, mixed, number, object, ref, string } from "yup";

import { type Option } from "@/utils/common";

/** The API's minimum for new backup passwords. */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_RETENTION = 50;
export const WORKSPACE_NAME_MAX_LENGTH = 100;

export const FREQUENCIES: readonly Option<BackupFrequency>[] = [
  { value: "manual", label: "Manual only" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

const KIND_LABELS: Record<BackupKind, string> = {
  manual: "Manual",
  scheduled: "Automatic",
  pre_restore: "Before restore",
};

const UPLOAD_STATUS_LABELS: Record<BackupUploadStatus, string> = {
  uploaded: "Ready to inspect",
  restoring: "Restoring…",
  completed: "Done",
  failed: "Failed",
  expired: "Expired",
  discarded: "Discarded",
};

const FORMAT_LABELS: Record<ExportFormat, string> = {
  json: "JSON",
  csv: "CSV",
  ics: "Calendar (.ics)",
  markdown: "Markdown",
};

export const STRATEGIES: readonly {
  value: RestoreStrategy;
  label: string;
  description: string;
}[] = [
  {
    value: "new_workspace",
    label: "Restore as a new workspace",
    description: "Nothing here changes. The backup becomes a workspace of its own.",
  },
  {
    value: "into_empty",
    label: "Restore into this workspace",
    description: "Only when this workspace has nothing in it yet.",
  },
  {
    value: "replace",
    label: "Replace this workspace’s data",
    description: "Everything here is replaced. A backup of the current data is made first.",
  },
];

export function kindLabel(kind: BackupKind): string {
  return KIND_LABELS[kind];
}

export function uploadStatusLabel(status: BackupUploadStatus): string {
  return UPLOAD_STATUS_LABELS[status];
}

export function formatLabel(format: ExportFormat): string {
  return FORMAT_LABELS[format];
}

export function frequencyLabel(frequency: BackupFrequency): string {
  return FREQUENCIES.find((option) => option.value === frequency)?.label ?? frequency;
}

/** `Nov 3, 2026, 10:30 AM` in the viewer's locale and zone. */
export function formatWhen(at: string): string {
  return new Date(at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** How a backup's records add up, for a history row: `1,204 records · 12 files`. */
export function describeContents(
  backup: Pick<Backup, "record_count" | "file_count" | "include_files">,
) {
  const records = `${backup.record_count.toLocaleString()} record${backup.record_count === 1 ? "" : "s"}`;
  if (!backup.include_files) return `${records} · no files`;
  return `${records} · ${backup.file_count.toLocaleString()} file${backup.file_count === 1 ? "" : "s"}`;
}

/** The status line for automatic backups. */
export function scheduleSummary(settings: BackupSettings): string {
  if (settings.frequency === "manual") return "Automatic backups are off.";
  const next = settings.next_run_at ? `Next: ${formatWhen(settings.next_run_at)}.` : "";
  return `${frequencyLabel(settings.frequency)}, keeping the last ${settings.retention_count}. ${next}`.trim();
}

/** One line on what a restore or import did (or would do, for a dry run). */
export function summarizeReport(report: RestoreReport): string {
  const { added, duplicates, matched, skipped } = report.totals;
  const verb = report.dry_run ? "to add" : "added";
  const parts = [`${added.toLocaleString()} record${added === 1 ? "" : "s"} ${verb}`];
  if (duplicates) parts.push(`${duplicates.toLocaleString()} already here`);
  if (matched) parts.push(`${matched.toLocaleString()} matched to existing ones`);
  if (skipped) parts.push(`${skipped.toLocaleString()} left out`);
  const files = report.files_restored + report.files_reused;
  if (files) parts.push(`${files.toLocaleString()} file${files === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

const passwordField = string()
  .defined()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(1024, "Use 1,024 characters or fewer.");

const confirmField = string()
  .defined()
  .oneOf([ref("password")], "The passwords don’t match.");

export const ENCRYPTION_CHOICES: readonly Option<BackupEncryption>[] = [
  { value: "none", label: "Not encrypted" },
  { value: "backup_key", label: "Backup password" },
  { value: "password", label: "A password for this backup" },
];

export const createBackupSchema = object({
  includeFiles: boolean().defined(),
  encryption: mixed<BackupEncryption>().oneOf(["none", "password", "backup_key"]).defined(),
  password: string()
    .defined()
    .when("encryption", { is: "password", then: () => passwordField, otherwise: (s) => s }),
  confirm: string()
    .defined()
    .when("encryption", { is: "password", then: () => confirmField, otherwise: (s) => s }),
});

export const backupSettingsSchema = object({
  frequency: mixed<BackupFrequency>().oneOf(["manual", "daily", "weekly", "monthly"]).defined(),
  retention: number()
    .typeError("Enter a number.")
    .integer("Enter a whole number.")
    .min(1, "Keep at least 1.")
    .max(MAX_RETENTION, `Keep at most ${MAX_RETENTION}.`)
    .defined(),
  includeFiles: boolean().defined(),
  encrypt: boolean().defined(),
  // Setting or changing the backup password; empty keeps the current one.
  password: string()
    .defined()
    .test(
      "length",
      `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      (value) => value === "" || value.length >= MIN_PASSWORD_LENGTH,
    ),
  confirm: string()
    .defined()
    .oneOf([ref("password")], "The passwords don’t match."),
});
