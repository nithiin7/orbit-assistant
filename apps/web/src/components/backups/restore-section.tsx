"use client";

import type {
  BackupInspection,
  BackupUpload,
  RestoreReport,
  RestoreStrategy,
} from "@orbit/contracts";
import { AlertTriangle, CheckCircle2, FileUp, Upload } from "lucide-react";
import { type ChangeEvent, useId, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { FormAlert, FormField } from "@/components/form-field";
import { ErrorText, Section } from "@/components/integrations/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useDiscardUpload,
  useInspectUpload,
  useRestoreUpload,
  useUploadBackup,
} from "@/hooks/use-backups";
import {
  formatWhen,
  STRATEGIES,
  summarizeReport,
  uploadStatusLabel,
  WORKSPACE_NAME_MAX_LENGTH,
} from "@/lib/backups";
import { formatFileSize } from "@/lib/documents";
import { useWorkspaces } from "@/providers/workspace";
import { cn } from "@/utils/common";

const ACCEPT = ".zip,.orbit-backup,.json,application/zip,application/json";

type Step =
  | { kind: "idle" }
  | { kind: "password"; upload: BackupUpload; error: string | null }
  | { kind: "review"; upload: BackupUpload; inspection: BackupInspection; password: string | null }
  | { kind: "done"; report: RestoreReport };

/** Restore a backup or import an export: upload, inspect, choose, confirm, and report. */
export function RestoreSection({ uploads }: { uploads: BackupUpload[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadBackup();
  const inspect = useInspectUpload();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const busy = upload.isPending || inspect.isPending;

  async function runInspection(staged: BackupUpload, password: string | null) {
    try {
      const inspection = await inspect.mutateAsync({ uploadId: staged.id, password });
      setStep({ kind: "review", upload: staged, inspection, password });
    } catch (reason) {
      const message = describeApiError(reason, "Couldn’t inspect this file.");
      if (staged.encrypted) setStep({ kind: "password", upload: staged, error: message });
      else setError(message);
    }
  }

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setStep({ kind: "idle" });
    try {
      const staged = await upload.mutateAsync(file);
      if (staged.encrypted) setStep({ kind: "password", upload: staged, error: null });
      else await runInspection(staged, null);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t upload this file. Try again."));
    }
  }

  return (
    <Section
      id="backup-restore"
      icon={FileUp}
      title="Restore and import"
      description="Restore an Orbit backup, or import records from an Orbit JSON export. You’ll see what the file holds and what would change before anything does."
      action={
        step.kind === "idle" ? (
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
            <Upload aria-hidden="true" />
            {upload.isPending ? "Uploading…" : inspect.isPending ? "Checking…" : "Choose a file"}
          </Button>
        ) : null
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Backup or export file"
        onChange={(event) => void choose(event)}
      />
      <ErrorText message={error} />
      {step.kind === "password" ? (
        <PasswordStep
          upload={step.upload}
          error={step.error}
          busy={inspect.isPending}
          onSubmit={(password) => void runInspection(step.upload, password)}
          onCancel={() => setStep({ kind: "idle" })}
        />
      ) : step.kind === "review" ? (
        <Review
          upload={step.upload}
          inspection={step.inspection}
          password={step.password}
          onDone={(report) => setStep({ kind: "done", report })}
          onCancel={() => setStep({ kind: "idle" })}
        />
      ) : step.kind === "done" ? (
        <Done report={step.report} onClose={() => setStep({ kind: "idle" })} />
      ) : (
        <RecentUploads uploads={uploads} />
      )}
    </Section>
  );
}

function PasswordStep({
  upload,
  error,
  busy,
  onSubmit,
  onCancel,
}: {
  upload: BackupUpload;
  error: string | null;
  busy: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (password) onSubmit(password);
      }}
    >
      <p className="text-sm">
        <span className="font-medium">{upload.filename}</span> is encrypted. Enter its password to
        see what it holds.
      </p>
      <FormField
        label="Backup password"
        type="password"
        autoComplete="off"
        autoFocus
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <FormAlert message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !password}>
          {busy ? "Checking…" : "Open"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Review({
  upload,
  inspection,
  password,
  onDone,
  onCancel,
}: {
  upload: BackupUpload;
  inspection: BackupInspection;
  password: string | null;
  onDone: (report: RestoreReport) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const { state } = useWorkspaces();
  const restore = useRestoreUpload();
  const discard = useDiscardUpload();
  const { confirm, confirmDialog } = useConfirm();
  const isExport = upload.kind === "export";
  const current = state.status === "ready" ? state.active : null;
  const empty = inspection.target.record_count === 0;
  const [strategy, setStrategy] = useState<RestoreStrategy>("new_workspace");
  const [name, setName] = useState(`${inspection.summary.source_workspace_name} (restored)`);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const repeat = inspection.warnings.some((warning) => warning.includes("already"));
  const summary = inspection.summary;
  const modules = Object.entries(summary.module_counts).filter(([, count]) => count > 0);

  const blocked =
    !inspection.compatible ||
    (strategy === "replace" &&
      (confirmName !== current?.name || inspection.target.has_integrations)) ||
    (strategy === "into_empty" && !empty) ||
    (strategy === "new_workspace" && name.trim().length === 0);

  async function submit() {
    setError(null);
    const replacing = !isExport && strategy === "replace";
    const confirmed = await confirm(
      isExport
        ? {
            title: "Import these records?",
            description: `They’re added to “${current?.name ?? "this workspace"}”. Records already here are left as they are.`,
            confirmLabel: "Import",
          }
        : replacing
          ? {
              title: `Replace everything in “${current?.name ?? "this workspace"}”?`,
              description:
                "Its records and files are replaced by the backup’s. A backup of the current data is made first, so you can go back.",
              confirmLabel: "Replace data",
              destructive: true,
            }
          : {
              title: "Restore this backup?",
              description:
                strategy === "new_workspace"
                  ? `It becomes a new workspace, “${name.trim()}”.`
                  : `It’s restored into “${current?.name ?? "this workspace"}”.`,
              confirmLabel: "Restore",
            },
    );
    if (!confirmed) return;
    try {
      const report = await restore.mutateAsync({
        uploadId: upload.id,
        body: {
          strategy: isExport ? null : strategy,
          password,
          workspace_name: !isExport && strategy === "new_workspace" ? name.trim() : null,
          confirm_name: replacing ? confirmName : null,
          allow_repeat: repeat,
          dry_run: false,
        },
      });
      onDone(report);
    } catch (reason) {
      setError(describeApiError(reason, "The restore didn’t finish. Nothing was changed."));
    }
  }

  async function cancel() {
    try {
      await discard.mutateAsync(upload.id);
    } catch {
      // The upload expires on its own within a day; nothing else depends on discarding it now.
    }
    onCancel();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {upload.filename}{" "}
          <span className="font-normal text-muted-foreground">
            · {formatFileSize(upload.size_bytes)}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">
          {isExport ? "Export" : "Backup"} of “{summary.source_workspace_name}”, made{" "}
          {formatWhen(summary.created_at)} by Orbit {summary.app_version || "(unknown version)"}.
          {upload.encrypted ? " Encrypted." : ""}
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium">What it holds</h3>
        {modules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No records.</p>
        ) : (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {modules.map(([module, count]) => (
              <li key={module}>
                <Badge variant="outline">
                  {module} · {count.toLocaleString()}
                </Badge>
              </li>
            ))}
            {summary.file_count ? (
              <li>
                <Badge variant="outline">
                  files · {summary.file_count} ({formatFileSize(summary.file_bytes)})
                </Badge>
              </li>
            ) : null}
          </ul>
        )}
      </div>

      {inspection.issues.length ? (
        <div role="alert" className="space-y-1 rounded-xl border border-destructive/40 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            This file can’t be {isExport ? "imported" : "restored"}
          </p>
          {inspection.issues.map((issue) => (
            <p key={issue} className="text-sm text-destructive">
              {issue}
            </p>
          ))}
        </div>
      ) : null}
      {inspection.warnings.length ? (
        <ul className="space-y-1">
          {inspection.warnings.map((warning) => (
            <li
              key={warning}
              className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
      {inspection.dry_run ? (
        <p className="text-sm">
          <span className="font-medium">Dry run: </span>
          {summarizeReport(inspection.dry_run)}
          {inspection.dry_run.remapped > 0 && !isExport
            ? ". Its records already exist here, so the copy gets new IDs."
            : "."}
        </p>
      ) : null}

      {!isExport && inspection.compatible ? (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Where to restore it</legend>
          {STRATEGIES.map((option) => {
            const unavailable =
              (option.value === "into_empty" && !empty) ||
              (option.value === "replace" && inspection.target.has_integrations);
            return (
              <label
                key={option.value}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3 text-sm",
                  strategy === option.value && "border-brand bg-brand-subtle/40",
                  unavailable && "opacity-60",
                )}
              >
                <input
                  type="radio"
                  name={`${id}-strategy`}
                  value={option.value}
                  checked={strategy === option.value}
                  disabled={unavailable}
                  onChange={() => setStrategy(option.value)}
                  className="mt-1 accent-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="space-y-0.5">
                  <span className="block font-medium">{option.label}</span>
                  <span className="block text-muted-foreground">
                    {option.value === "into_empty" && !empty
                      ? "This workspace already has records."
                      : option.value === "replace" && inspection.target.has_integrations
                        ? "Disconnect this workspace’s integrations first."
                        : option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : null}

      {!isExport && strategy === "new_workspace" ? (
        <FormField
          label="New workspace name"
          maxLength={WORKSPACE_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      ) : null}
      {!isExport && strategy === "replace" ? (
        <FormField
          label={`Type “${current?.name ?? ""}” to confirm`}
          autoComplete="off"
          value={confirmName}
          onChange={(event) => setConfirmName(event.target.value)}
        />
      ) : null}

      <FormAlert message={error} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant={!isExport && strategy === "replace" ? "destructive" : "default"}
          disabled={blocked || restore.isPending}
          onClick={() => void submit()}
        >
          {restore.isPending
            ? isExport
              ? "Importing…"
              : "Restoring…"
            : isExport
              ? "Import records"
              : strategy === "replace"
                ? "Replace data"
                : "Restore"}
        </Button>
        <Button variant="ghost" onClick={() => void cancel()} disabled={restore.isPending}>
          Cancel
        </Button>
      </div>
      {confirmDialog}
    </div>
  );
}

function Done({ report, onClose }: { report: RestoreReport; onClose: () => void }) {
  const { state, switchWorkspace } = useWorkspaces();
  const elsewhere = state.status === "ready" && state.active.id !== report.workspace_id;
  return (
    <div role="status" className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-medium text-brand">
        <CheckCircle2 className="size-4" aria-hidden="true" />
        {report.strategy === "merge" ? "Imported" : "Restored"} into “{report.workspace_name}”.
      </p>
      <p className="text-sm">{summarizeReport(report)}.</p>
      {report.warnings.map((warning) => (
        <p key={warning} className="text-sm text-amber-700 dark:text-amber-400">
          {warning}
        </p>
      ))}
      {report.pre_restore_backup_id ? (
        <p className="text-sm text-muted-foreground">
          The data it replaced is in the “Before restore” backup in the history.
        </p>
      ) : null}
      <div className="flex gap-2">
        {elsewhere ? (
          <Button variant="soft" onClick={() => switchWorkspace(report.workspace_id)}>
            Open “{report.workspace_name}”
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function RecentUploads({ uploads }: { uploads: BackupUpload[] }) {
  const recent = uploads.filter((upload) => upload.status !== "discarded").slice(0, 5);
  if (recent.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Choose a backup (.zip or .orbit-backup) or a JSON export to begin.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Recent restores and imports</h3>
      <ul className="divide-y overflow-hidden rounded-xl border">
        {recent.map((upload) => (
          <li
            key={upload.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
          >
            <span className="min-w-0 flex-1 truncate">{upload.filename}</span>
            <span className="text-xs text-muted-foreground">{formatWhen(upload.created_at)}</span>
            <Badge
              variant={upload.status === "completed" ? "brand" : "outline"}
              className={cn(upload.status === "failed" && "text-destructive")}
            >
              {uploadStatusLabel(upload.status)}
            </Badge>
            {upload.status === "failed" && upload.error ? (
              <span className="w-full text-xs text-destructive">{upload.error}</span>
            ) : upload.result ? (
              <span className="w-full text-xs text-muted-foreground">
                {summarizeReport(upload.result)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
