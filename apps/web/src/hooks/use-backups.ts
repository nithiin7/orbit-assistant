"use client";

import type {
  BackupOverview,
  CreateBackupRequest,
  ExportArchiveRequest,
  ExportModuleRequest,
  RestoreReport,
  RestoreUploadRequest,
  UpdateBackupSettingsRequest,
} from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  backupKeys,
  backupOverviewOptions,
  createBackup,
  deleteBackup,
  discardUpload,
  downloadBackup,
  exportArchive,
  exportModule,
  inspectUpload,
  restoreUpload,
  revealBackupsFolder,
  updateBackupSettings,
  uploadBackup,
  verifyBackup,
} from "@/api/backups";
import { workspaceKeys } from "@/api/workspaces";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";
import { useWorkspaces } from "@/providers/workspace";
import { saveBlob } from "@/utils/download";

function requireWorkspace(workspaceId: string | null): string {
  if (workspaceId === null) throw new Error("No workspace is selected.");
  return workspaceId;
}

export function useBackupOverview(): Resource<BackupOverview> {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const result = useQuery(backupOverviewOptions(withToken, workspaceId));
  useWorkspaceNotFound(result.error);
  return queryResource(result, "Couldn’t load backups.");
}

/** Mutations on the active workspace's backups, which refresh the overview when they settle. */
function useBackupMutation<V, R>(
  run: (token: string, workspaceId: string, variables: V) => Promise<R>,
) {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: V) => {
      const id = requireWorkspace(workspaceId);
      return withToken((token) => run(token, id, variables));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: backupKeys.all(workspaceId) }),
  });
}

export function useCreateBackup() {
  return useBackupMutation((token, workspaceId, body: CreateBackupRequest) =>
    createBackup(token, workspaceId, body),
  );
}

export function useUpdateBackupSettings() {
  return useBackupMutation((token, workspaceId, body: UpdateBackupSettingsRequest) =>
    updateBackupSettings(token, workspaceId, body),
  );
}

export function useDeleteBackup() {
  return useBackupMutation((token, workspaceId, backupId: string) =>
    deleteBackup(token, workspaceId, backupId),
  );
}

export function useRevealBackupsFolder() {
  return useBackupMutation((token, workspaceId, _: void) =>
    revealBackupsFolder(token, workspaceId),
  );
}

export function useVerifyBackup() {
  return useBackupMutation(
    (token, workspaceId, { backupId, password }: { backupId: string; password: string | null }) =>
      verifyBackup(token, workspaceId, backupId, { password }),
  );
}

/** Downloads go straight to a file; they change nothing on the server. */
function useDownload<V>(
  fetchFile: (
    token: string,
    workspaceId: string,
    variables: V,
  ) => Promise<{ blob: Blob; filename: string }>,
) {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  return useMutation({
    mutationFn: async (variables: V) => {
      const id = requireWorkspace(workspaceId);
      const file = await withToken((token) => fetchFile(token, id, variables));
      saveBlob(file.blob, file.filename);
    },
  });
}

export function useDownloadBackup() {
  return useDownload((token, workspaceId, backupId: string) =>
    downloadBackup(token, workspaceId, backupId),
  );
}

export function useExportArchive() {
  return useDownload((token, workspaceId, body: ExportArchiveRequest) =>
    exportArchive(token, workspaceId, body),
  );
}

export function useExportModule() {
  return useDownload((token, workspaceId, body: ExportModuleRequest) =>
    exportModule(token, workspaceId, body),
  );
}

export function useUploadBackup() {
  return useBackupMutation((token, workspaceId, file: File) =>
    uploadBackup(token, workspaceId, file),
  );
}

export function useInspectUpload() {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  return useMutation({
    mutationFn: ({ uploadId, password }: { uploadId: string; password: string | null }) => {
      const id = requireWorkspace(workspaceId);
      return withToken((token) => inspectUpload(token, id, uploadId, { password }));
    },
  });
}

export function useDiscardUpload() {
  return useBackupMutation((token, workspaceId, uploadId: string) =>
    discardUpload(token, workspaceId, uploadId),
  );
}

/**
 * Restore or import. Afterwards everything cached for the affected workspace is reloaded, and a
 * workspace a restore created appears in the workspace list.
 */
export function useRestoreUpload() {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const { refresh } = useWorkspaces();
  return useMutation({
    mutationFn: ({ uploadId, body }: { uploadId: string; body: RestoreUploadRequest }) => {
      const id = requireWorkspace(workspaceId);
      return withToken((token) => restoreUpload(token, id, uploadId, body));
    },
    onSuccess: async (report: RestoreReport) => {
      if (report.dry_run) return;
      refresh();
      await queryClient.invalidateQueries({ queryKey: workspaceKeys.list() });
      await queryClient.invalidateQueries({
        queryKey: workspaceKeys.workspace(report.workspace_id),
      });
      if (report.workspace_id !== workspaceId) {
        await queryClient.invalidateQueries({ queryKey: backupKeys.all(workspaceId) });
      }
    },
  });
}
