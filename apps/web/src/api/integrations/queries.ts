import type { IntegrationConnectionDetail, IntegrationEntityType } from "@orbit/contracts";
import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import {
  type FileQuery,
  getConnection,
  getMessage,
  listConflicts,
  listConnections,
  listIntegrationProviders,
  listMailLabels,
  listMessages,
  listOrigins,
  listRemoteFiles,
  type MailQuery,
} from "./requests";

export const integrationKeys = {
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "integrations"] as const,
  providers: (workspaceId: string | null) =>
    [...integrationKeys.all(workspaceId), "providers"] as const,
  connections: (workspaceId: string | null) =>
    [...integrationKeys.all(workspaceId), "connections"] as const,
  connection: (workspaceId: string | null, connectionId: string) =>
    [...integrationKeys.connections(workspaceId), connectionId] as const,
  conflicts: (workspaceId: string | null) =>
    [...integrationKeys.all(workspaceId), "conflicts"] as const,
  origins: (workspaceId: string | null, entityType: string, entityId: string) =>
    [...integrationKeys.all(workspaceId), "origins", entityType, entityId] as const,
  labels: (workspaceId: string | null, connectionId: string) =>
    [...integrationKeys.connection(workspaceId, connectionId), "labels"] as const,
  messages: (workspaceId: string | null, connectionId: string, query: MailQuery) =>
    [...integrationKeys.connection(workspaceId, connectionId), "messages", query] as const,
  message: (workspaceId: string | null, connectionId: string, messageId: string) =>
    [...integrationKeys.connection(workspaceId, connectionId), "message", messageId] as const,
  files: (workspaceId: string | null, connectionId: string, query: FileQuery) =>
    [...integrationKeys.connection(workspaceId, connectionId), "files", query] as const,
};

export function integrationProvidersOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: integrationKeys.providers(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listIntegrationProviders(token, workspaceId, { signal })),
    staleTime: 5 * 60_000,
  });
}

export function connectionsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: integrationKeys.connections(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listConnections(token, workspaceId, { signal })),
  });
}

/** True while a synchronization is queued or running, so the view polls for its result. */
export function isSyncing(detail: IntegrationConnectionDetail | undefined): boolean {
  return detail?.runs.some((run) => run.status === "queued" || run.status === "running") ?? false;
}

export function connectionOptions(
  withToken: WithToken,
  workspaceId: string | null,
  connectionId: string,
) {
  return queryOptions({
    queryKey: integrationKeys.connection(workspaceId, connectionId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getConnection(token, workspaceId, connectionId, { signal })),
    // The worker runs synchronizations; poll while one is in progress.
    refetchInterval: (query) => (isSyncing(query.state.data) ? 3_000 : false),
  });
}

export function conflictsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: integrationKeys.conflicts(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listConflicts(token, workspaceId, { signal })),
  });
}

export function originsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  entityType: IntegrationEntityType,
  entityId: string,
) {
  return queryOptions({
    queryKey: integrationKeys.origins(workspaceId, entityType, entityId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listOrigins(token, workspaceId, entityType, entityId, { signal })),
  });
}

export function mailLabelsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  connectionId: string,
) {
  return queryOptions({
    queryKey: integrationKeys.labels(workspaceId, connectionId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listMailLabels(token, workspaceId, connectionId, { signal })),
    retry: false,
  });
}

/** Messages are read from the provider on request and never stored by Orbit. */
export function messagesOptions(
  withToken: WithToken,
  workspaceId: string | null,
  connectionId: string,
  query: MailQuery | null,
) {
  return queryOptions({
    queryKey: integrationKeys.messages(workspaceId, connectionId, query ?? { labelId: "" }),
    queryFn:
      workspaceId === null || query === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listMessages(token, workspaceId, connectionId, query, { signal })),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function messageOptions(
  withToken: WithToken,
  workspaceId: string | null,
  connectionId: string,
  messageId: string | null,
) {
  return queryOptions({
    queryKey: integrationKeys.message(workspaceId, connectionId, messageId ?? ""),
    queryFn:
      workspaceId === null || messageId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) =>
              getMessage(token, workspaceId, connectionId, messageId, { signal }),
            ),
    retry: false,
  });
}

export function remoteFilesOptions(
  withToken: WithToken,
  workspaceId: string | null,
  connectionId: string,
  query: FileQuery,
) {
  return queryOptions({
    queryKey: integrationKeys.files(workspaceId, connectionId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) =>
              listRemoteFiles(token, workspaceId, connectionId, query, { signal }),
            ),
    placeholderData: keepPreviousData,
    retry: false,
  });
}
