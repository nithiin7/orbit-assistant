"use client";

import type {
  CreateDocumentCategoryRequest,
  CreateDocumentFolderRequest,
  CreateDocumentRequest,
  DocumentDetail,
  DocumentFolderDeleteMode,
  DocumentLinkKind,
  DocumentListQuery,
  ExportDocumentsRequest,
  RenewDocumentRequest,
  UpdateDocumentCategoryRequest,
  UpdateDocumentFolderRequest,
  UpdateDocumentRequest,
} from "@orbit/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  applyDocumentChange,
  createDocument,
  createDocumentCategory,
  createDocumentFolder,
  deleteDocument,
  deleteDocumentCategory,
  deleteDocumentFolder,
  deleteDocumentVersion,
  type DocumentAction,
  documentAction,
  documentCategoriesOptions,
  documentCountsOptions,
  documentFoldersOptions,
  documentKeys,
  documentListOptions,
  documentOptions,
  documentOverviewOptions,
  documentSettingsOptions,
  documentTagsOptions,
  downloadDocumentFile,
  emptyDocumentTrash,
  exportDocuments,
  linkCandidatesOptions,
  linkDocument,
  markDocumentOpened,
  renewDocument,
  restoreDocumentVersion,
  unlinkDocument,
  updateDocument,
  updateDocumentCategory,
  updateDocumentFolder,
  uploadDocument,
  uploadDocumentVersion,
  type UploadOptions,
} from "@/api/documents";
import { reminderKeys } from "@/api/reminders";
import { queryResource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";

/** The workspace's documents for `query`, keeping the previous page on screen while it changes. */
export function useDocumentList(
  workspaceId: string | null,
  query: DocumentListQuery,
  enabled = true,
) {
  const { withToken } = useAuth();
  const result = useQuery({
    ...documentListOptions(withToken, workspaceId, query),
    placeholderData: keepPreviousData,
    enabled,
  });
  useWorkspaceNotFound(result.error);
  const { refetch } = result;
  const reload = useCallback(() => void refetch(), [refetch]);
  const state = queryResource(result, "Couldn’t load your documents.");
  return { state, refreshing: state.status === "success" && result.isFetching, reload };
}

export function useDocumentOverview(workspaceId: string | null) {
  const { withToken } = useAuth();
  const result = useQuery(documentOverviewOptions(withToken, workspaceId));
  useWorkspaceNotFound(result.error);
  const { refetch } = result;
  const reload = useCallback(() => void refetch(), [refetch]);
  return { state: queryResource(result, "Couldn’t load the overview."), reload };
}

export function useDocumentCounts(workspaceId: string) {
  const { withToken } = useAuth();
  return useQuery(documentCountsOptions(withToken, workspaceId)).data;
}

export function useDocumentSettings(workspaceId: string) {
  const { withToken } = useAuth();
  return useQuery(documentSettingsOptions(withToken, workspaceId)).data;
}

export function useDocumentFolders(workspaceId: string | null) {
  const { withToken } = useAuth();
  const result = useQuery(documentFoldersOptions(withToken, workspaceId));
  return {
    folders: result.data?.folders ?? [],
    state: queryResource(result, "Couldn’t load folders."),
  };
}

export function useDocumentCategories(workspaceId: string | null) {
  const { withToken } = useAuth();
  const result = useQuery(documentCategoriesOptions(withToken, workspaceId));
  return {
    categories: result.data?.categories ?? [],
    state: queryResource(result, "Couldn’t load categories."),
  };
}

export function useDocumentTags(workspaceId: string) {
  const { withToken } = useAuth();
  return useQuery(documentTagsOptions(withToken, workspaceId)).data?.tags ?? [];
}

export function useDocument(workspaceId: string, documentId: string) {
  const { withToken } = useAuth();
  const result = useQuery(documentOptions(withToken, workspaceId, documentId));
  const { refetch } = result;
  const reload = useCallback(() => void refetch(), [refetch]);
  return { state: queryResource(result, "Couldn’t open this document."), reload };
}

export function useLinkCandidates(
  workspaceId: string,
  kind: DocumentLinkKind,
  search: string,
  enabled: boolean,
) {
  const { withToken } = useAuth();
  return queryResource(
    useQuery({
      ...linkCandidatesOptions(withToken, workspaceId, kind, search),
      placeholderData: keepPreviousData,
      enabled,
    }),
    "Couldn’t load records to link.",
  );
}

/** Changes to documents, their files, and their links. Each refreshes what it affects. */
export function useDocumentMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();

  // Document changes can move their managed reminders too.
  const saved = async (detail: DocumentDetail) => {
    await applyDocumentChange(queryClient, workspaceId, detail);
    void queryClient.invalidateQueries({ queryKey: reminderKeys.all(workspaceId) });
  };
  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: documentKeys.all(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: reminderKeys.all(workspaceId) });
  };

  const create = useMutation({
    mutationFn: (body: CreateDocumentRequest) =>
      withToken((token) => createDocument(token, workspaceId, body)),
    onSuccess: saved,
  });
  const upload = useMutation({
    mutationFn: ({ file, options }: { file: File; options?: UploadOptions }) =>
      withToken((token) => uploadDocument(token, workspaceId, file, options)),
    onSuccess: saved,
  });
  const update = useMutation({
    mutationFn: ({ documentId, changes }: { documentId: string; changes: UpdateDocumentRequest }) =>
      withToken((token) => updateDocument(token, workspaceId, documentId, changes)),
    onSuccess: saved,
  });
  const act = useMutation({
    mutationFn: ({ documentId, action }: { documentId: string; action: DocumentAction }) =>
      withToken((token) => documentAction(token, workspaceId, documentId, action)),
    onSuccess: saved,
  });
  const renew = useMutation({
    mutationFn: ({ documentId, body }: { documentId: string; body: RenewDocumentRequest }) =>
      withToken((token) => renewDocument(token, workspaceId, documentId, body)),
    onSuccess: saved,
  });
  const remove = useMutation({
    mutationFn: (documentId: string) =>
      withToken((token) => deleteDocument(token, workspaceId, documentId)),
    onSuccess: (_result, documentId) => {
      queryClient.removeQueries({ queryKey: documentKeys.detail(workspaceId, documentId) });
      refreshAll();
    },
  });
  const emptyTrash = useMutation({
    mutationFn: () => withToken((token) => emptyDocumentTrash(token, workspaceId)),
    onSuccess: refreshAll,
  });
  const opened = useMutation({
    mutationFn: (documentId: string) =>
      withToken((token) => markDocumentOpened(token, workspaceId, documentId)),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: documentKeys.lists(workspaceId) }),
  });
  const uploadVersion = useMutation({
    mutationFn: ({ documentId, file, note }: { documentId: string; file: File; note?: string }) =>
      withToken((token) => uploadDocumentVersion(token, workspaceId, documentId, file, note)),
    onSuccess: saved,
  });
  const restoreVersion = useMutation({
    mutationFn: ({ documentId, versionId }: { documentId: string; versionId: string }) =>
      withToken((token) => restoreDocumentVersion(token, workspaceId, documentId, versionId)),
    onSuccess: saved,
  });
  const deleteVersion = useMutation({
    mutationFn: ({ documentId, versionId }: { documentId: string; versionId: string }) =>
      withToken((token) => deleteDocumentVersion(token, workspaceId, documentId, versionId)),
    onSuccess: refreshAll,
  });
  const link = useMutation({
    mutationFn: ({
      documentId,
      kind,
      id,
    }: {
      documentId: string;
      kind: DocumentLinkKind;
      id: string;
    }) => withToken((token) => linkDocument(token, workspaceId, documentId, kind, id)),
    onSuccess: refreshAll,
  });
  const unlink = useMutation({
    mutationFn: ({
      documentId,
      kind,
      id,
    }: {
      documentId: string;
      kind: DocumentLinkKind;
      id: string;
    }) => withToken((token) => unlinkDocument(token, workspaceId, documentId, kind, id)),
    onSuccess: refreshAll,
  });

  const download = useCallback(
    (documentId: string, versionId: string | null = null) =>
      withToken((token) => downloadDocumentFile(token, workspaceId, documentId, versionId)),
    [withToken, workspaceId],
  );
  const exportArchive = useCallback(
    (body: ExportDocumentsRequest) =>
      withToken((token) => exportDocuments(token, workspaceId, body)),
    [withToken, workspaceId],
  );

  return {
    create,
    upload,
    update,
    act,
    renew,
    remove,
    emptyTrash,
    opened,
    uploadVersion,
    restoreVersion,
    deleteVersion,
    link,
    unlink,
    download,
    exportArchive,
  };
}

/** Folder and category changes. */
export function useDocumentOrganizer(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: documentKeys.all(workspaceId) });

  const createFolder = useMutation({
    mutationFn: (body: CreateDocumentFolderRequest) =>
      withToken((token) => createDocumentFolder(token, workspaceId, body)),
    onSuccess: refresh,
  });
  const updateFolder = useMutation({
    mutationFn: ({
      folderId,
      changes,
    }: {
      folderId: string;
      changes: UpdateDocumentFolderRequest;
    }) => withToken((token) => updateDocumentFolder(token, workspaceId, folderId, changes)),
    onSuccess: refresh,
  });
  const deleteFolder = useMutation({
    mutationFn: ({
      folderId,
      mode,
      targetId,
    }: {
      folderId: string;
      mode: DocumentFolderDeleteMode;
      targetId?: string | null;
    }) => withToken((token) => deleteDocumentFolder(token, workspaceId, folderId, mode, targetId)),
    onSuccess: refresh,
  });
  const createCategory = useMutation({
    mutationFn: (body: CreateDocumentCategoryRequest) =>
      withToken((token) => createDocumentCategory(token, workspaceId, body)),
    onSuccess: refresh,
  });
  const updateCategory = useMutation({
    mutationFn: ({
      categoryId,
      changes,
    }: {
      categoryId: string;
      changes: UpdateDocumentCategoryRequest;
    }) => withToken((token) => updateDocumentCategory(token, workspaceId, categoryId, changes)),
    onSuccess: refresh,
  });
  const deleteCategory = useMutation({
    mutationFn: (categoryId: string) =>
      withToken((token) => deleteDocumentCategory(token, workspaceId, categoryId)),
    onSuccess: refresh,
  });

  return {
    createFolder,
    updateFolder,
    deleteFolder,
    createCategory,
    updateCategory,
    deleteCategory,
  };
}
