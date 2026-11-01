import type { DocumentDetail, DocumentLinkKind, DocumentListQuery } from "@orbit/contracts";
import { type QueryClient, queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import {
  getDocument,
  getDocumentCounts,
  getDocumentOverview,
  getDocumentSettings,
  listDocumentCategories,
  listDocumentFolders,
  listDocuments,
  listDocumentTags,
  listLinkCandidates,
} from "./requests";

/**
 * Cache keys for a workspace's documents. Every key starts with the workspace ID, so one
 * workspace's documents can never be served for another. `null` (no active workspace yet) never
 * fetches.
 */
export const documentKeys = {
  /** Everything cached for the workspace's documents. */
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "documents"] as const,
  lists: (workspaceId: string | null) => [...documentKeys.all(workspaceId), "list"] as const,
  list: (workspaceId: string | null, query: DocumentListQuery) =>
    [...documentKeys.lists(workspaceId), query] as const,
  overview: (workspaceId: string | null) => [...documentKeys.all(workspaceId), "overview"] as const,
  counts: (workspaceId: string | null) => [...documentKeys.all(workspaceId), "counts"] as const,
  settings: (workspaceId: string | null) => [...documentKeys.all(workspaceId), "settings"] as const,
  detail: (workspaceId: string | null, documentId: string) =>
    [...documentKeys.all(workspaceId), "detail", documentId] as const,
  folders: (workspaceId: string | null) => [...documentKeys.all(workspaceId), "folders"] as const,
  categories: (workspaceId: string | null) =>
    [...documentKeys.all(workspaceId), "categories"] as const,
  tags: (workspaceId: string | null) => [...documentKeys.all(workspaceId), "tags"] as const,
  candidates: (workspaceId: string | null, kind: DocumentLinkKind, search: string) =>
    [...documentKeys.all(workspaceId), "candidates", kind, search] as const,
};

function withWorkspace<T>(
  withToken: WithToken,
  workspaceId: string | null,
  call: (token: string, workspaceId: string, signal: AbortSignal) => Promise<T>,
) {
  return workspaceId === null
    ? skipToken
    : ({ signal }: { signal: AbortSignal }) =>
        withToken((token) => call(token, workspaceId, signal));
}

export function documentListOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: DocumentListQuery,
) {
  return queryOptions({
    queryKey: documentKeys.list(workspaceId, query),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      listDocuments(token, id, query, { signal }),
    ),
  });
}

export function documentOverviewOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: documentKeys.overview(workspaceId),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      getDocumentOverview(token, id, { signal }),
    ),
  });
}

export function documentCountsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: documentKeys.counts(workspaceId),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      getDocumentCounts(token, id, { signal }),
    ),
  });
}

export function documentSettingsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: documentKeys.settings(workspaceId),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      getDocumentSettings(token, id, { signal }),
    ),
    // Server configuration; it doesn't change while the app is open.
    staleTime: Infinity,
  });
}

export function documentOptions(
  withToken: WithToken,
  workspaceId: string | null,
  documentId: string,
) {
  return queryOptions({
    queryKey: documentKeys.detail(workspaceId, documentId),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      getDocument(token, id, documentId, { signal }),
    ),
  });
}

export function documentFoldersOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: documentKeys.folders(workspaceId),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      listDocumentFolders(token, id, { signal }),
    ),
  });
}

export function documentCategoriesOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: documentKeys.categories(workspaceId),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      listDocumentCategories(token, id, { signal }),
    ),
  });
}

export function documentTagsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: documentKeys.tags(workspaceId),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      listDocumentTags(token, id, { signal }),
    ),
  });
}

export function linkCandidatesOptions(
  withToken: WithToken,
  workspaceId: string | null,
  kind: DocumentLinkKind,
  search: string,
) {
  return queryOptions({
    queryKey: documentKeys.candidates(workspaceId, kind, search),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      listLinkCandidates(token, id, kind, search, { signal }),
    ),
  });
}

/** Show a changed document at once, then refresh the lists, counts, and overview it appears in. */
export async function applyDocumentChange(
  queryClient: QueryClient,
  workspaceId: string,
  detail: DocumentDetail,
): Promise<void> {
  queryClient.setQueryData(documentKeys.detail(workspaceId, detail.document.id), detail);
  await queryClient.invalidateQueries({
    queryKey: documentKeys.all(workspaceId),
    predicate: (query) => query.queryKey[3] !== "detail" && query.queryKey[3] !== "settings",
  });
}
