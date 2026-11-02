import type {
  AuthorizeIntegrationRequest,
  AuthorizeIntegrationResult,
  CompleteAuthorizationRequest,
  DisconnectIntegrationResult,
  ImportedFile,
  ImportFileRequest,
  IntegrationCalendar,
  IntegrationCalendarList,
  IntegrationConflictList,
  IntegrationConflictResolution,
  IntegrationConnection,
  IntegrationConnectionDetail,
  IntegrationConnectionList,
  IntegrationEntityType,
  IntegrationLink,
  IntegrationOriginList,
  IntegrationProviderList,
  IntegrationRecord,
  IntegrationSyncRun,
  IntegrationSyncRunList,
  MailLabelList,
  MailMessageDetail,
  MailMessageList,
  RemoteFileList,
  ResolveIntegrationConflictResult,
  UpdateIntegrationCalendarRequest,
  UpdateIntegrationConnectionRequest,
} from "@orbit/contracts";

import { request, type Signal, toQueryString, workspacePath } from "../client";

function base(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/integrations${suffix}`);
}

function connection(workspaceId: string, connectionId: string, suffix = ""): string {
  return base(workspaceId, `/connections/${encodeURIComponent(connectionId)}${suffix}`);
}

// Providers and connecting

export function listIntegrationProviders(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<IntegrationProviderList> {
  return request<IntegrationProviderList>(base(workspaceId, "/providers"), { token, signal });
}

export function authorizeIntegration(
  token: string,
  workspaceId: string,
  body: AuthorizeIntegrationRequest,
): Promise<AuthorizeIntegrationResult> {
  return request<AuthorizeIntegrationResult>(base(workspaceId, "/authorize"), {
    method: "POST",
    body,
    token,
  });
}

/** Finishes connecting, with what the provider sent to the callback page. */
export function completeAuthorization(
  token: string,
  body: CompleteAuthorizationRequest,
): Promise<IntegrationConnection> {
  return request<IntegrationConnection>("/api/v1/integrations/oauth/complete", {
    method: "POST",
    body,
    token,
  });
}

// Connections

export function listConnections(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<IntegrationConnectionList> {
  return request<IntegrationConnectionList>(base(workspaceId, "/connections"), { token, signal });
}

export function getConnection(
  token: string,
  workspaceId: string,
  connectionId: string,
  { signal }: Signal = {},
): Promise<IntegrationConnectionDetail> {
  return request<IntegrationConnectionDetail>(connection(workspaceId, connectionId), {
    token,
    signal,
  });
}

export function updateConnection(
  token: string,
  workspaceId: string,
  connectionId: string,
  body: UpdateIntegrationConnectionRequest,
): Promise<IntegrationConnection> {
  return request<IntegrationConnection>(connection(workspaceId, connectionId), {
    method: "PATCH",
    body,
    token,
  });
}

export function checkConnection(
  token: string,
  workspaceId: string,
  connectionId: string,
): Promise<IntegrationConnection> {
  return request<IntegrationConnection>(connection(workspaceId, connectionId, "/check"), {
    method: "POST",
    token,
  });
}

export function disconnect(
  token: string,
  workspaceId: string,
  connectionId: string,
  removeImported: boolean,
): Promise<DisconnectIntegrationResult> {
  const query = toQueryString({ remove_imported: removeImported || undefined });
  return request<DisconnectIntegrationResult>(connection(workspaceId, connectionId, query), {
    method: "DELETE",
    token,
  });
}

// Calendars and synchronization

export function refreshCalendars(
  token: string,
  workspaceId: string,
  connectionId: string,
): Promise<IntegrationCalendarList> {
  return request<IntegrationCalendarList>(
    connection(workspaceId, connectionId, "/calendars/refresh"),
    { method: "POST", token },
  );
}

export function updateCalendar(
  token: string,
  workspaceId: string,
  connectionId: string,
  calendarId: string,
  body: UpdateIntegrationCalendarRequest,
): Promise<IntegrationCalendar> {
  return request<IntegrationCalendar>(
    connection(workspaceId, connectionId, `/calendars/${encodeURIComponent(calendarId)}`),
    { method: "PATCH", body, token },
  );
}

export function exportEvent(
  token: string,
  workspaceId: string,
  connectionId: string,
  calendarId: string,
  eventId: string,
): Promise<IntegrationLink> {
  return request<IntegrationLink>(
    connection(workspaceId, connectionId, `/calendars/${encodeURIComponent(calendarId)}/events`),
    { method: "POST", body: { event_id: eventId }, token },
  );
}

export function syncNow(
  token: string,
  workspaceId: string,
  connectionId: string,
  calendarId?: string,
): Promise<IntegrationSyncRunList> {
  return request<IntegrationSyncRunList>(connection(workspaceId, connectionId, "/sync"), {
    method: "POST",
    body: { resource_id: calendarId ?? null },
    token,
  });
}

export function cancelRun(
  token: string,
  workspaceId: string,
  connectionId: string,
  runId: string,
): Promise<IntegrationSyncRun> {
  return request<IntegrationSyncRun>(
    connection(workspaceId, connectionId, `/runs/${encodeURIComponent(runId)}/cancel`),
    { method: "POST", token },
  );
}

export function retryRun(
  token: string,
  workspaceId: string,
  connectionId: string,
  runId: string,
): Promise<IntegrationSyncRun> {
  return request<IntegrationSyncRun>(
    connection(workspaceId, connectionId, `/runs/${encodeURIComponent(runId)}/retry`),
    { method: "POST", token },
  );
}

// Conflicts and origins

export function listConflicts(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<IntegrationConflictList> {
  return request<IntegrationConflictList>(base(workspaceId, "/conflicts"), { token, signal });
}

export function resolveConflict(
  token: string,
  workspaceId: string,
  linkId: string,
  resolution: IntegrationConflictResolution,
): Promise<ResolveIntegrationConflictResult> {
  return request<ResolveIntegrationConflictResult>(
    base(workspaceId, `/conflicts/${encodeURIComponent(linkId)}/resolve`),
    { method: "POST", body: { resolution }, token },
  );
}

export function listOrigins(
  token: string,
  workspaceId: string,
  entityType: IntegrationEntityType,
  entityId: string,
  { signal }: Signal = {},
): Promise<IntegrationOriginList> {
  const query = toQueryString({ entity_type: entityType, entity_id: entityId });
  return request<IntegrationOriginList>(base(workspaceId, `/origins${query}`), { token, signal });
}

// Mail

export function listMailLabels(
  token: string,
  workspaceId: string,
  connectionId: string,
  { signal }: Signal = {},
): Promise<MailLabelList> {
  return request<MailLabelList>(connection(workspaceId, connectionId, "/mail/labels"), {
    token,
    signal,
  });
}

export function selectMailLabels(
  token: string,
  workspaceId: string,
  connectionId: string,
  labelIds: string[],
): Promise<MailLabelList> {
  return request<MailLabelList>(connection(workspaceId, connectionId, "/mail/labels"), {
    method: "PUT",
    body: { label_ids: labelIds },
    token,
  });
}

export type MailQuery = { labelId: string; search?: string; page?: string };

export function listMessages(
  token: string,
  workspaceId: string,
  connectionId: string,
  query: MailQuery,
  { signal }: Signal = {},
): Promise<MailMessageList> {
  const params = toQueryString({ label_id: query.labelId, q: query.search, page: query.page });
  return request<MailMessageList>(
    connection(workspaceId, connectionId, `/mail/messages${params}`),
    {
      token,
      signal,
    },
  );
}

function message(workspaceId: string, connectionId: string, messageId: string, suffix = "") {
  return connection(
    workspaceId,
    connectionId,
    `/mail/messages/${encodeURIComponent(messageId)}${suffix}`,
  );
}

export function getMessage(
  token: string,
  workspaceId: string,
  connectionId: string,
  messageId: string,
  { signal }: Signal = {},
): Promise<MailMessageDetail> {
  return request<MailMessageDetail>(message(workspaceId, connectionId, messageId), {
    token,
    signal,
  });
}

export type RecordFromMessage =
  | { kind: "task"; body: { title: string; description?: string } }
  | { kind: "note"; body: { title: string; text?: string } }
  | {
      kind: "reminder";
      body: { title: string; start_date: string; time_of_day: string; description?: string };
    };

export function createFromMessage(
  token: string,
  workspaceId: string,
  connectionId: string,
  messageId: string,
  record: RecordFromMessage,
): Promise<IntegrationRecord> {
  return request<IntegrationRecord>(
    message(workspaceId, connectionId, messageId, `/${record.kind}`),
    { method: "POST", body: record.body, token },
  );
}

export function unlinkMessage(
  token: string,
  workspaceId: string,
  connectionId: string,
  linkId: string,
): Promise<void> {
  return request<void>(
    connection(workspaceId, connectionId, `/links/${encodeURIComponent(linkId)}`),
    { method: "DELETE", token },
  );
}

// Files

export type FileQuery = { folderId?: string; search?: string; page?: string };

export function listRemoteFiles(
  token: string,
  workspaceId: string,
  connectionId: string,
  query: FileQuery,
  { signal }: Signal = {},
): Promise<RemoteFileList> {
  const params = toQueryString({ folder_id: query.folderId, q: query.search, page: query.page });
  return request<RemoteFileList>(connection(workspaceId, connectionId, `/files${params}`), {
    token,
    signal,
  });
}

export function importRemoteFile(
  token: string,
  workspaceId: string,
  connectionId: string,
  fileId: string,
  body: ImportFileRequest = {},
): Promise<ImportedFile> {
  return request<ImportedFile>(
    connection(workspaceId, connectionId, `/files/${encodeURIComponent(fileId)}/import`),
    { method: "POST", body, token },
  );
}

export function updateRemoteFile(
  token: string,
  workspaceId: string,
  connectionId: string,
  linkId: string,
): Promise<ImportedFile> {
  return request<ImportedFile>(
    connection(workspaceId, connectionId, `/files/links/${encodeURIComponent(linkId)}/update`),
    { method: "POST", token },
  );
}
