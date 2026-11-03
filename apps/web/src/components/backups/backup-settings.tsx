"use client";

import type { Backup, BackupOverview } from "@orbit/contracts";
import {
  AlertTriangle,
  Archive,
  Download,
  History,
  Lock,
  LockOpen,
  MoreHorizontal,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { ErrorText, Section } from "@/components/integrations/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useBackupOverview,
  useDeleteBackup,
  useDownloadBackup,
  useVerifyBackup,
} from "@/hooks/use-backups";
import { describeContents, formatWhen, kindLabel, scheduleSummary } from "@/lib/backups";
import { formatFileSize } from "@/lib/documents";
import { cn } from "@/utils/common";

import { AutomaticBackups } from "./automatic-backups";
import { CreateBackupDialog } from "./create-backup-dialog";
import { ExportSection } from "./export-section";
import { PasswordDialog } from "./password-dialog";
import { RestoreSection } from "./restore-section";

/** Settings → Backup & restore: backups, history, restore and import, exports, and schedule. */
export function BackupSettings() {
  const overview = useBackupOverview();
  if (overview.status === "loading") {
    return (
      <div aria-busy="true" className="space-y-4">
        <span className="sr-only">Loading backups…</span>
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }
  if (overview.status === "error") return <ErrorText message={overview.message} />;
  const data = overview.data;
  return (
    <div className="space-y-6">
      <Overview overview={data} />
      <BackupHistory backups={data.backups} />
      <RestoreSection uploads={data.uploads} />
      <ExportSection modules={data.modules} />
      <AutomaticBackups settings={data.settings} />
    </div>
  );
}

function Overview({ overview }: { overview: BackupOverview }) {
  const [creating, setCreating] = useState(false);
  const latest = overview.backups[0];
  const failed = latest?.status === "failed";
  return (
    <Section
      id="backup-overview"
      icon={Archive}
      title="Backups"
      description="A backup holds this workspace’s records and files, checksummed so a damaged copy is caught before it’s restored."
      action={
        <Button onClick={() => setCreating(true)} disabled={overview.running}>
          {overview.running ? "Backing up…" : "Create backup"}
        </Button>
      }
    >
      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">Last successful backup</dt>
          <dd className="font-medium">
            {overview.last_success_at ? formatWhen(overview.last_success_at) : "None yet"}
          </dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">Stored on the server</dt>
          <dd className="font-medium">
            {overview.backups.length
              ? `${overview.backups.length} · ${formatFileSize(overview.total_bytes)}`
              : "Nothing yet"}
          </dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">Automatic backups</dt>
          <dd className="font-medium">{scheduleSummary(overview.settings)}</dd>
        </div>
      </dl>
      {failed ? (
        <p role="status" className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          The latest backup failed{latest.error ? `: ${latest.error}` : "."}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Backups are kept where the Orbit API runs (this computer in local mode). Download one to
        keep a copy somewhere else: a backup on the same disk doesn’t survive that disk.
      </p>
      {creating ? (
        <CreateBackupDialog
          hasBackupPassword={overview.settings.has_backup_password}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </Section>
  );
}

function BackupHistory({ backups }: { backups: Backup[] }) {
  return (
    <Section
      id="backup-history"
      icon={History}
      title="History"
      description="Every backup of this workspace, newest first."
    >
      {backups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No backups yet. Create one above, or turn on automatic backups below.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {backups.map((backup) => (
            <BackupRow key={backup.id} backup={backup} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function BackupRow({ backup }: { backup: Backup }) {
  const download = useDownloadBackup();
  const remove = useDeleteBackup();
  const verify = useVerifyBackup();
  const { confirm, confirmDialog } = useConfirm();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [askingPassword, setAskingPassword] = useState(false);
  const succeeded = backup.status === "succeeded";

  async function check(password: string | null) {
    setMessage(null);
    try {
      const result = await verify.mutateAsync({ backupId: backup.id, password });
      setMessage({ text: result.message, ok: result.ok });
    } catch (reason) {
      setMessage({ text: describeApiError(reason, "Couldn’t check this backup."), ok: false });
    }
  }

  async function save() {
    setMessage(null);
    try {
      await download.mutateAsync(backup.id);
    } catch (reason) {
      setMessage({ text: describeApiError(reason, "Couldn’t download this backup."), ok: false });
    }
  }

  async function discard() {
    const confirmed = await confirm({
      title: "Delete this backup?",
      description: `The backup from ${formatWhen(backup.created_at)} is removed from the server. Copies you downloaded aren’t affected.`,
      confirmLabel: "Delete backup",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync(backup.id);
    } catch (reason) {
      setMessage({ text: describeApiError(reason, "Couldn’t delete this backup."), ok: false });
    }
  }

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{formatWhen(backup.created_at)}</span>
            <Badge variant={backup.kind === "manual" ? "default" : "brand"}>
              {kindLabel(backup.kind)}
            </Badge>
            {backup.status === "running" ? <Badge variant="outline">Running…</Badge> : null}
            {backup.status === "failed" ? (
              <Badge variant="outline" className="text-destructive">
                Failed
              </Badge>
            ) : null}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {succeeded ? (
              <>
                <span>{describeContents(backup)}</span>
                <span aria-hidden="true">·</span>
                <span>{formatFileSize(backup.size_bytes ?? 0)}</span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  {backup.encrypted ? (
                    <Lock className="size-3" aria-hidden="true" />
                  ) : (
                    <LockOpen className="size-3" aria-hidden="true" />
                  )}
                  {backup.encrypted ? "Encrypted" : "Not encrypted"}
                </span>
              </>
            ) : (
              <span>{backup.error ?? (backup.status === "running" ? "In progress" : "")}</span>
            )}
          </span>
        </span>
        {succeeded ? (
          <div className="flex items-center gap-1">
            <Button
              variant="soft"
              size="sm"
              onClick={() => void save()}
              disabled={download.isPending}
            >
              <Download aria-hidden="true" />
              {download.isPending ? "Downloading…" : "Download"}
            </Button>
            <Menu
              aria-label={`More for the backup from ${formatWhen(backup.created_at)}`}
              variant="ghost"
              size="icon"
              chevron={false}
              align="end"
              items={[
                {
                  id: "verify",
                  label: "Check integrity",
                  description: "Compare it with its checksums",
                  icon: ShieldCheck,
                  onSelect: () => {
                    if (backup.encrypted) setAskingPassword(true);
                    else void check(null);
                  },
                },
                {
                  id: "delete",
                  label: "Delete",
                  icon: Trash2,
                  destructive: true,
                  onSelect: () => void discard(),
                },
              ]}
            >
              <MoreHorizontal aria-hidden="true" />
            </Menu>
          </div>
        ) : backup.status === "failed" ? (
          <Button variant="ghost" size="sm" onClick={() => void discard()}>
            Remove
          </Button>
        ) : null}
      </div>
      {backup.warnings.map((warning) => (
        <p key={warning} className="text-xs text-amber-700 dark:text-amber-400">
          {warning}
        </p>
      ))}
      {verify.isPending ? (
        <p role="status" className="text-xs text-muted-foreground">
          Checking…
        </p>
      ) : message ? (
        <p role="status" className={cn("text-xs", message.ok ? "text-brand" : "text-destructive")}>
          {message.text}
        </p>
      ) : null}
      {askingPassword ? (
        <PasswordDialog
          title="Check an encrypted backup"
          description="Enter the backup’s password to check every record and file too. Without it, only the archive’s checksum is compared."
          submitLabel="Check"
          optional
          onSubmit={async (password) => check(password)}
          onClose={() => setAskingPassword(false)}
        />
      ) : null}
      {confirmDialog}
    </li>
  );
}
