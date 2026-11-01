import type {
  CreateDocumentCategoryRequest,
  CreateDocumentFolderRequest,
  CreateDocumentRequest,
  DocumentCategory,
  DocumentCategoryList,
  DocumentCounts,
  DocumentDetail,
  DocumentFolder,
  DocumentFolderDeleteMode,
  DocumentFolderList,
  DocumentLinkCandidates,
  DocumentLinkKind,
  DocumentList,
  DocumentListQuery,
  DocumentOverview,
  DocumentSettings,
  DocumentTagList,
  ExportDocumentsRequest,
  RenewDocumentRequest,
  UpdateDocumentCategoryRequest,
  UpdateDocumentFolderRequest,
  UpdateDocumentRequest,
} from "@orbit/contracts";

import { request, send, type Signal, toQueryString, workspacePath } from "../client";

function documentsPath(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/documents${suffix}`);
}

function documentPath(workspaceId: string, documentId: string, suffix = ""): string {
  return documentsPath(workspaceId, `/${encodeURIComponent(documentId)}${suffix}`);
}

// Documents

export function listDocuments(
  token: string,
  workspaceId: string,
  query: DocumentListQuery = {},
  { signal }: Signal = {},
): Promise<DocumentList> {
  return request<DocumentList>(`${documentsPath(workspaceId)}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function getDocumentOverview(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<DocumentOverview> {
  return request<DocumentOverview>(documentsPath(workspaceId, "/overview"), { token, signal });
}

export function getDocumentCounts(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<DocumentCounts> {
  return request<DocumentCounts>(documentsPath(workspaceId, "/counts"), { token, signal });
}

export function getDocumentSettings(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<DocumentSettings> {
  return request<DocumentSettings>(documentsPath(workspaceId, "/settings"), { token, signal });
}

export function listDocumentTags(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<DocumentTagList> {
  return request<DocumentTagList>(documentsPath(workspaceId, "/tags"), { token, signal });
}

export function getDocument(
  token: string,
  workspaceId: string,
  documentId: string,
  { signal }: Signal = {},
): Promise<DocumentDetail> {
  return request<DocumentDetail>(documentPath(workspaceId, documentId), { token, signal });
}

/** A document without a file; its first file can be uploaded later as a version. */
export function createDocument(
  token: string,
  workspaceId: string,
  body: CreateDocumentRequest,
): Promise<DocumentDetail> {
  return request<DocumentDetail>(documentsPath(workspaceId), { method: "POST", body, token });
}

export type UploadOptions = {
  title?: string;
  folderId?: string | null;
  categoryId?: string | null;
};

/** Upload a file as a new document. The API decides its type from the name and contents. */
export function uploadDocument(
  token: string,
  workspaceId: string,
  file: File,
  { title, folderId, categoryId }: UploadOptions = {},
  { signal }: Signal = {},
): Promise<DocumentDetail> {
  const query = toQueryString({
    filename: file.name,
    title,
    folder_id: folderId,
    category_id: categoryId,
  });
  return request<DocumentDetail>(documentsPath(workspaceId, `/upload${query}`), {
    method: "POST",
    body: file,
    token,
    signal,
  });
}

export function updateDocument(
  token: string,
  workspaceId: string,
  documentId: string,
  body: UpdateDocumentRequest,
): Promise<DocumentDetail> {
  return request<DocumentDetail>(documentPath(workspaceId, documentId), {
    method: "PATCH",
    body,
    token,
  });
}

export type DocumentAction = "trash" | "restore";

export function documentAction(
  token: string,
  workspaceId: string,
  documentId: string,
  action: DocumentAction,
): Promise<DocumentDetail> {
  return request<DocumentDetail>(documentPath(workspaceId, documentId, `/${action}`), {
    method: "POST",
    token,
  });
}

export function markDocumentOpened(
  token: string,
  workspaceId: string,
  documentId: string,
): Promise<void> {
  return request<void>(documentPath(workspaceId, documentId, "/open"), { method: "POST", token });
}

/** Permanent, with every version and file; only for documents in the trash. */
export function deleteDocument(token: string, workspaceId: string, documentId: string) {
  return request<void>(documentPath(workspaceId, documentId), { method: "DELETE", token });
}

export function emptyDocumentTrash(token: string, workspaceId: string) {
  return request<{ deleted: number }>(documentsPath(workspaceId, "/empty-trash"), {
    method: "POST",
    token,
  });
}

export function renewDocument(
  token: string,
  workspaceId: string,
  documentId: string,
  body: RenewDocumentRequest,
): Promise<DocumentDetail> {
  return request<DocumentDetail>(documentPath(workspaceId, documentId, "/renew"), {
    method: "POST",
    body,
    token,
  });
}

// Files and versions

/**
 * A file's bytes: the current version's, or `versionId`'s. Every request carries the bearer
 * token, so there's no URL that works on its own; previews use the blob.
 */
export async function downloadDocumentFile(
  token: string,
  workspaceId: string,
  documentId: string,
  versionId: string | null = null,
  { signal }: Signal = {},
): Promise<Blob> {
  const suffix = versionId ? `/versions/${encodeURIComponent(versionId)}/file` : "/file";
  const response = await send(documentPath(workspaceId, documentId, suffix), { token, signal });
  return response.blob();
}

export function uploadDocumentVersion(
  token: string,
  workspaceId: string,
  documentId: string,
  file: File,
  note = "",
): Promise<DocumentDetail> {
  const query = toQueryString({ filename: file.name, note: note || undefined });
  return request<DocumentDetail>(documentPath(workspaceId, documentId, `/versions${query}`), {
    method: "POST",
    body: file,
    token,
  });
}

export function restoreDocumentVersion(
  token: string,
  workspaceId: string,
  documentId: string,
  versionId: string,
): Promise<DocumentDetail> {
  return request<DocumentDetail>(
    documentPath(workspaceId, documentId, `/versions/${encodeURIComponent(versionId)}/restore`),
    { method: "POST", token },
  );
}

export function deleteDocumentVersion(
  token: string,
  workspaceId: string,
  documentId: string,
  versionId: string,
): Promise<void> {
  return request<void>(
    documentPath(workspaceId, documentId, `/versions/${encodeURIComponent(versionId)}`),
    { method: "DELETE", token },
  );
}

// Links

function linkPath(workspaceId: string, documentId: string, kind: DocumentLinkKind, id: string) {
  return documentPath(
    workspaceId,
    documentId,
    `/links/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
  );
}

export function linkDocument(
  token: string,
  workspaceId: string,
  documentId: string,
  kind: DocumentLinkKind,
  targetId: string,
): Promise<void> {
  return request<void>(linkPath(workspaceId, documentId, kind, targetId), {
    method: "PUT",
    token,
  });
}

export function unlinkDocument(
  token: string,
  workspaceId: string,
  documentId: string,
  kind: DocumentLinkKind,
  targetId: string,
): Promise<void> {
  return request<void>(linkPath(workspaceId, documentId, kind, targetId), {
    method: "DELETE",
    token,
  });
}

export function listLinkCandidates(
  token: string,
  workspaceId: string,
  kind: DocumentLinkKind,
  search: string,
  { signal }: Signal = {},
): Promise<DocumentLinkCandidates> {
  const query = toQueryString({ kind, q: search || undefined });
  return request<DocumentLinkCandidates>(documentsPath(workspaceId, `/link-candidates${query}`), {
    token,
    signal,
  });
}

// Export

/** A ZIP of the chosen documents' files and their metadata. */
export async function exportDocuments(
  token: string,
  workspaceId: string,
  body: ExportDocumentsRequest,
): Promise<Blob> {
  const response = await send(documentsPath(workspaceId, "/export"), {
    method: "POST",
    body,
    token,
  });
  return response.blob();
}

// Folders

function foldersPath(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/document-folders${suffix}`);
}

export function listDocumentFolders(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<DocumentFolderList> {
  return request<DocumentFolderList>(foldersPath(workspaceId), { token, signal });
}

export function createDocumentFolder(
  token: string,
  workspaceId: string,
  body: CreateDocumentFolderRequest,
): Promise<DocumentFolder> {
  return request<DocumentFolder>(foldersPath(workspaceId), { method: "POST", body, token });
}

export function updateDocumentFolder(
  token: string,
  workspaceId: string,
  folderId: string,
  body: UpdateDocumentFolderRequest,
): Promise<DocumentFolder> {
  return request<DocumentFolder>(foldersPath(workspaceId, `/${encodeURIComponent(folderId)}`), {
    method: "PATCH",
    body,
    token,
  });
}

/** Never deletes documents: `mode` says where the folder's documents go. */
export function deleteDocumentFolder(
  token: string,
  workspaceId: string,
  folderId: string,
  mode: DocumentFolderDeleteMode,
  targetId: string | null = null,
): Promise<void> {
  const query = toQueryString({ documents: mode, target_id: targetId });
  return request<void>(foldersPath(workspaceId, `/${encodeURIComponent(folderId)}${query}`), {
    method: "DELETE",
    token,
  });
}

// Categories

function categoriesPath(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/document-categories${suffix}`);
}

/** The workspace's categories; the defaults are created the first time. */
export function listDocumentCategories(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<DocumentCategoryList> {
  return request<DocumentCategoryList>(categoriesPath(workspaceId), { token, signal });
}

export function createDocumentCategory(
  token: string,
  workspaceId: string,
  body: CreateDocumentCategoryRequest,
): Promise<DocumentCategory> {
  return request<DocumentCategory>(categoriesPath(workspaceId), { method: "POST", body, token });
}

export function updateDocumentCategory(
  token: string,
  workspaceId: string,
  categoryId: string,
  body: UpdateDocumentCategoryRequest,
): Promise<DocumentCategory> {
  return request<DocumentCategory>(
    categoriesPath(workspaceId, `/${encodeURIComponent(categoryId)}`),
    { method: "PATCH", body, token },
  );
}

/** Its documents stay, without a category. */
export function deleteDocumentCategory(
  token: string,
  workspaceId: string,
  categoryId: string,
): Promise<void> {
  return request<void>(categoriesPath(workspaceId, `/${encodeURIComponent(categoryId)}`), {
    method: "DELETE",
    token,
  });
}
