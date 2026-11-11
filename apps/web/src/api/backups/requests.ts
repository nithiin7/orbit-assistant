import type {
  ArchivePasswordRequest,
  Backup,
  BackupInspection,
  BackupOverview,
  BackupSettings,
  BackupUpload,
  BackupVerification,
  CreateBackupRequest,
  ExportArchiveRequest,
  ExportModuleRequest,
  RestoreReport,
  RestoreUploadRequest,
  UpdateBackupSettingsRequest,
} from "@orbit/contracts";

import { request, send, type Signal, toQueryString, workspacePath } from "../client";

/** A downloaded file and the name the API gave it. */
export type DownloadedFile = { blob: Blob; filename: string };

function backups(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/backups${suffix}`);
}

function uploads(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/backup-uploads${suffix}`);
}

/** The file name from `Content-Disposition: attachment; filename*=UTF-8''…`. */
export function attachmentName(response: Response, fallback: string): string {
  const header = response.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (!match?.[1]) return fallback;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return fallback;
  }
}

async function download(response: Response, fallback: string): Promise<DownloadedFile> {
  return { blob: await response.blob(), filename: attachmentName(response, fallback) };
}

// Backups

export function getBackupOverview(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<BackupOverview> {
  return request<BackupOverview>(backups(workspaceId), { token, signal });
}

export function createBackup(
  token: string,
  workspaceId: string,
  body: CreateBackupRequest,
): Promise<Backup> {
  return request<Backup>(backups(workspaceId), { method: "POST", body, token });
}

export function updateBackupSettings(
  token: string,
  workspaceId: string,
  body: UpdateBackupSettingsRequest,
): Promise<BackupSettings> {
  return request<BackupSettings>(backups(workspaceId, "/settings"), {
    method: "PUT",
    body,
    token,
  });
}

/** A stored backup's archive. Needs the token, so there's no URL that works on its own. */
export async function downloadBackup(
  token: string,
  workspaceId: string,
  backupId: string,
): Promise<DownloadedFile> {
  const response = await send(backups(workspaceId, `/${encodeURIComponent(backupId)}/download`), {
    token,
  });
  return download(response, "orbit-backup.zip");
}

export function verifyBackup(
  token: string,
  workspaceId: string,
  backupId: string,
  body: ArchivePasswordRequest,
): Promise<BackupVerification> {
  return request<BackupVerification>(
    backups(workspaceId, `/${encodeURIComponent(backupId)}/verify`),
    { method: "POST", body, token },
  );
}

/** Open this workspace's backup folder in the file manager on the API's machine (local mode). */
export function revealBackupsFolder(token: string, workspaceId: string): Promise<void> {
  return request<void>(backups(workspaceId, "/reveal"), { method: "POST", token });
}

export function deleteBackup(token: string, workspaceId: string, backupId: string) {
  return request<void>(backups(workspaceId, `/${encodeURIComponent(backupId)}`), {
    method: "DELETE",
    token,
  });
}

// Exports

/** A backup archive built for this download only (not kept on the server). */
export async function exportArchive(
  token: string,
  workspaceId: string,
  body: ExportArchiveRequest,
): Promise<DownloadedFile> {
  const response = await send(workspacePath(workspaceId, "/exports/archive"), {
    method: "POST",
    body,
    token,
  });
  return download(response, "orbit-backup.zip");
}

export async function exportModule(
  token: string,
  workspaceId: string,
  body: ExportModuleRequest,
): Promise<DownloadedFile> {
  const response = await send(workspacePath(workspaceId, "/exports"), {
    method: "POST",
    body,
    token,
  });
  return download(response, `orbit-${body.module ?? "workspace"}.${body.format}`);
}

// Uploads, inspection, and restore

/** Stage a backup or export on the server; nothing is restored yet. */
export function uploadBackup(
  token: string,
  workspaceId: string,
  file: File,
): Promise<BackupUpload> {
  const body = new Blob([file], { type: "application/octet-stream" });
  return request<BackupUpload>(uploads(workspaceId, toQueryString({ filename: file.name })), {
    method: "POST",
    body,
    token,
  });
}

export function inspectUpload(
  token: string,
  workspaceId: string,
  uploadId: string,
  body: ArchivePasswordRequest,
): Promise<BackupInspection> {
  return request<BackupInspection>(
    uploads(workspaceId, `/${encodeURIComponent(uploadId)}/inspect`),
    { method: "POST", body, token },
  );
}

export function restoreUpload(
  token: string,
  workspaceId: string,
  uploadId: string,
  body: RestoreUploadRequest,
): Promise<RestoreReport> {
  return request<RestoreReport>(uploads(workspaceId, `/${encodeURIComponent(uploadId)}/restore`), {
    method: "POST",
    body,
    token,
  });
}

export function discardUpload(token: string, workspaceId: string, uploadId: string) {
  return request<void>(uploads(workspaceId, `/${encodeURIComponent(uploadId)}`), {
    method: "DELETE",
    token,
  });
}
