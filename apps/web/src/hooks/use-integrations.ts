"use client";

import type {
  IntegrationCapability,
  IntegrationConflictList,
  IntegrationConflictResolution,
  IntegrationConnection,
  IntegrationConnectionDetail,
  IntegrationConnectionList,
  IntegrationEntityType,
  IntegrationOriginList,
  IntegrationProviderId,
  IntegrationProviderList,
  MailLabelList,
  MailMessageDetail,
  MailMessageList,
  RemoteFileList,
  UpdateIntegrationCalendarRequest,
} from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  authorizeIntegration,
  cancelRun,
  checkConnection,
  completeAuthorization,
  conflictsOptions,
  connectionOptions,
  connectionsOptions,
  createFromMessage,
  disconnect,
  type FileQuery,
  importRemoteFile,
  integrationKeys,
  integrationProvidersOptions,
  mailLabelsOptions,
  type MailQuery,
  messageOptions,
  messagesOptions,
  originsOptions,
  type RecordFromMessage,
  refreshCalendars,
  remoteFilesOptions,
  resolveConflict,
  retryRun,
  selectMailLabels,
  syncNow,
  unlinkMessage,
  updateCalendar,
  updateConnection,
  updateRemoteFile,
} from "@/api/integrations";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";

export function useIntegrationProviders(): Resource<IntegrationProviderList> {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const result = useQuery(integrationProvidersOptions(withToken, workspaceId));
  useWorkspaceNotFound(result.error);
  return queryResource(result, "Couldn’t load the available integrations.");
}

export function useConnections(): Resource<IntegrationConnectionList> {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const result = useQuery(connectionsOptions(withToken, workspaceId));
  useWorkspaceNotFound(result.error);
  return queryResource(result, "Couldn’t load connected accounts.");
}

/**
 * Connected accounts that granted a service (mail, files, calendar), for showing that service
 * where it's used rather than only in Settings. Empty while loading or when nothing is connected.
 */
export function useConnectionsWith(capability: IntegrationCapability): IntegrationConnection[] {
  const connections = useConnections();
  return connections.status === "success"
    ? connections.data.connections.filter((c) => c.capabilities.includes(capability))
    : [];
}

export function useConnection(connectionId: string): Resource<IntegrationConnectionDetail> {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  return queryResource(
    useQuery(connectionOptions(withToken, workspaceId, connectionId)),
    "Couldn’t load this connection.",
  );
}

export function useConflicts(): Resource<IntegrationConflictList> {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  return queryResource(
    useQuery(conflictsOptions(withToken, workspaceId)),
    "Couldn’t load synchronization conflicts.",
  );
}

export function useOrigins(
  entityType: IntegrationEntityType,
  entityId: string,
): Resource<IntegrationOriginList> {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  return queryResource(
    useQuery(originsOptions(withToken, workspaceId, entityType, entityId)),
    "Couldn’t load where this came from.",
  );
}

export function useMailLabels(connectionId: string): Resource<MailLabelList> {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  return queryResource(
    useQuery(mailLabelsOptions(withToken, workspaceId, connectionId)),
    "Couldn’t load mail labels.",
  );
}

export function useMessages(
  connectionId: string,
  query: MailQuery | null,
): Resource<MailMessageList> {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  return queryResource(
    useQuery(messagesOptions(withToken, workspaceId, connectionId, query)),
    "Couldn’t load messages.",
  );
}

export function useMessage(
  connectionId: string,
  messageId: string | null,
): Resource<MailMessageDetail> {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  return queryResource(
    useQuery(messageOptions(withToken, workspaceId, connectionId, messageId)),
    "Couldn’t open this message.",
  );
}

export function useRemoteFiles(connectionId: string, query: FileQuery): Resource<RemoteFileList> {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  return queryResource(
    useQuery(remoteFilesOptions(withToken, workspaceId, connectionId, query)),
    "Couldn’t load files.",
  );
}

/** Connecting: asks the API for the provider's consent page. */
export function useAuthorizeIntegration() {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  return useMutation({
    mutationFn: (body: {
      provider: IntegrationProviderId;
      capabilities: IntegrationCapability[];
      connectionId?: string;
    }) => {
      if (workspaceId === null) throw new Error("No workspace is selected.");
      return withToken((token) =>
        authorizeIntegration(token, workspaceId, {
          provider: body.provider,
          capabilities: body.capabilities,
          connection_id: body.connectionId ?? null,
        }),
      );
    },
  });
}

export function useCompleteAuthorization() {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { state: string; code: string | null; error: string | null }) =>
      withToken((token) => completeAuthorization(token, body)),
    onSuccess: (connection) => {
      void queryClient.invalidateQueries({
        queryKey: integrationKeys.all(connection.workspace_id),
      });
    },
  });
}

/** Changes to one connection. Each refreshes what it affects. */
export function useConnectionMutations(connectionId: string) {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const call = <T>(action: (token: string, workspaceId: string) => Promise<T>) => {
    if (workspaceId === null) return Promise.reject(new Error("No workspace is selected."));
    return withToken((token) => action(token, workspaceId));
  };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: integrationKeys.all(workspaceId) });
  };
  const refreshImported = () => {
    refresh();
    // Imported events and documents are ordinary Orbit records.
    void queryClient.invalidateQueries({ queryKey: ["workspaces", workspaceId, "calendar"] });
    void queryClient.invalidateQueries({ queryKey: ["workspaces", workspaceId, "documents"] });
  };

  return {
    update: useMutation({
      mutationFn: (mailDays: 7 | 30 | 90 | 365) =>
        call((t, w) => updateConnection(t, w, connectionId, { mail_days: mailDays })),
      onSuccess: refresh,
    }),
    check: useMutation({
      mutationFn: () => call((t, w) => checkConnection(t, w, connectionId)),
      onSuccess: refresh,
    }),
    disconnect: useMutation({
      mutationFn: (removeImported: boolean) =>
        call((t, w) => disconnect(t, w, connectionId, removeImported)),
      onSuccess: refreshImported,
    }),
    refreshCalendars: useMutation({
      mutationFn: () => call((t, w) => refreshCalendars(t, w, connectionId)),
      onSuccess: refresh,
    }),
    updateCalendar: useMutation({
      mutationFn: ({ id, body }: { id: string; body: UpdateIntegrationCalendarRequest }) =>
        call((t, w) => updateCalendar(t, w, connectionId, id, body)),
      onSuccess: refresh,
    }),
    sync: useMutation({
      mutationFn: (calendarId?: string) => call((t, w) => syncNow(t, w, connectionId, calendarId)),
      onSuccess: refreshImported,
    }),
    cancelRun: useMutation({
      mutationFn: (runId: string) => call((t, w) => cancelRun(t, w, connectionId, runId)),
      onSuccess: refresh,
    }),
    retryRun: useMutation({
      mutationFn: (runId: string) => call((t, w) => retryRun(t, w, connectionId, runId)),
      onSuccess: refresh,
    }),
    selectLabels: useMutation({
      mutationFn: (labelIds: string[]) =>
        call((t, w) => selectMailLabels(t, w, connectionId, labelIds)),
      onSuccess: (labels) => {
        queryClient.setQueryData(integrationKeys.labels(workspaceId, connectionId), labels);
        refresh();
      },
    }),
    createFromMessage: useMutation({
      mutationFn: ({ messageId, record }: { messageId: string; record: RecordFromMessage }) =>
        call((t, w) => createFromMessage(t, w, connectionId, messageId, record)),
      onSuccess: (created) => {
        refresh();
        const area = `${created.kind}s`;
        void queryClient.invalidateQueries({ queryKey: ["workspaces", workspaceId, area] });
      },
    }),
    unlinkMessage: useMutation({
      mutationFn: (linkId: string) => call((t, w) => unlinkMessage(t, w, connectionId, linkId)),
      onSuccess: refresh,
    }),
    importFile: useMutation({
      mutationFn: ({ fileId, folderId }: { fileId: string; folderId?: string | null }) =>
        call((t, w) =>
          importRemoteFile(t, w, connectionId, fileId, folderId ? { folder_id: folderId } : {}),
        ),
      onSuccess: refreshImported,
    }),
    updateFile: useMutation({
      mutationFn: (linkId: string) => call((t, w) => updateRemoteFile(t, w, connectionId, linkId)),
      onSuccess: refreshImported,
    }),
  };
}

export function useResolveConflict() {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      linkId,
      resolution,
    }: {
      linkId: string;
      resolution: IntegrationConflictResolution;
    }) => {
      if (workspaceId === null) throw new Error("No workspace is selected.");
      return withToken((token) => resolveConflict(token, workspaceId, linkId, resolution));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationKeys.all(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: ["workspaces", workspaceId, "calendar"] });
    },
  });
}
