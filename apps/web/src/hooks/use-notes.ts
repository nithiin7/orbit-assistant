"use client";

import type {
  CreateNoteFolderRequest,
  CreateNoteRequest,
  FolderDeleteMode,
  Note,
  NoteListQuery,
  UpdateNoteFolderRequest,
  UpdateNoteRequest,
} from "@orbit/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  addNoteTag,
  attachmentsOptions,
  createNote,
  createNoteFolder,
  deleteAttachment,
  deleteNote,
  deleteNoteFolder,
  deleteTag,
  downloadAttachment,
  emptyTrash,
  linkNoteTask,
  markNoteOpened,
  noteAction,
  noteCountsOptions,
  noteFoldersOptions,
  noteKeys,
  noteLinksOptions,
  noteListOptions,
  noteOptions,
  noteTasksOptions,
  openJournalEntry,
  removeCachedNote,
  removeNoteTag,
  renameTag,
  replaceCachedNote,
  tagsOptions,
  unlinkNoteTask,
  updateNote,
  updateNoteFolder,
  uploadAttachment,
} from "@/api/notes";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";
import { useWorkspaces } from "@/providers/workspace";

/** The workspace's notes for `query`, keeping the previous results on screen while it changes. */
export function useNoteList(workspaceId: string | null, query: NoteListQuery, enabled = true) {
  const { withToken } = useAuth();
  const result = useQuery({
    ...noteListOptions(withToken, workspaceId, query),
    placeholderData: keepPreviousData,
    enabled,
  });
  useWorkspaceNotFound(result.error);
  const { refetch } = result;
  const reload = useCallback(() => void refetch(), [refetch]);
  const state = queryResource(result, "Couldn’t load your notes.");
  return { state, refreshing: state.status === "success" && result.isFetching, reload };
}

export function useNoteCounts(workspaceId: string) {
  const { withToken } = useAuth();
  return useQuery(noteCountsOptions(withToken, workspaceId)).data;
}

export function useNoteFolders(workspaceId: string | null) {
  const { withToken } = useAuth();
  const result = useQuery(noteFoldersOptions(withToken, workspaceId));
  return {
    folders: result.data?.folders ?? [],
    state: queryResource(result, "Couldn’t load folders."),
  };
}

export function useTags(workspaceId: string) {
  const { withToken } = useAuth();
  return useQuery(tagsOptions(withToken, workspaceId)).data?.tags ?? [];
}

export function useNote(
  workspaceId: string,
  noteId: string,
): {
  state: Resource<Note>;
  reload: () => void;
} {
  const { withToken } = useAuth();
  const result = useQuery(noteOptions(withToken, workspaceId, noteId));
  const { refetch } = result;
  const reload = useCallback(() => void refetch(), [refetch]);
  return { state: queryResource(result, "Couldn’t open this note."), reload };
}

export function useNoteLinks(workspaceId: string, noteId: string) {
  const { withToken } = useAuth();
  return queryResource(
    useQuery(noteLinksOptions(withToken, workspaceId, noteId)),
    "Couldn’t load links.",
  );
}

export function useNoteTasks(workspaceId: string, noteId: string) {
  const { withToken } = useAuth();
  return queryResource(
    useQuery(noteTasksOptions(withToken, workspaceId, noteId)),
    "Couldn’t load linked tasks.",
  );
}

export function useAttachments(workspaceId: string, noteId: string) {
  const { withToken } = useAuth();
  return queryResource(
    useQuery(attachmentsOptions(withToken, workspaceId, noteId)),
    "Couldn’t load attachments.",
  );
}

/** Notes linked to a task, for the task's dialog. Uses the active workspace. */
export function useTaskNotes(taskId: string) {
  const { withToken } = useAuth();
  const { state } = useWorkspaces();
  const workspaceId = state.status === "ready" ? state.active.id : null;
  const result = useQuery(
    noteListOptions(withToken, workspaceId, { task_id: taskId, limit: 20, sort: "updated_at" }),
  );
  return { workspaceId, state: queryResource(result, "Couldn’t load linked notes.") };
}

/**
 * Note changes for the workspace. Each updates the cache to match and refreshes the counts and
 * lists that may have changed. Await `mutateAsync` to handle failures.
 */
export function useNoteMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: noteKeys.lists(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: noteKeys.counts(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: noteKeys.folders(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: noteKeys.tags(workspaceId) });
  };
  const saved = (note: Note) => {
    replaceCachedNote(queryClient, workspaceId, note);
    refreshLists();
  };

  const create = useMutation({
    mutationFn: (draft: CreateNoteRequest) =>
      withToken((token) => createNote(token, workspaceId, draft)),
    onSuccess: saved,
  });

  /** Metadata changes: pin, favorite, archive, folder, type. Text goes through autosave. */
  const update = useMutation({
    mutationFn: ({ noteId, changes }: { noteId: string; changes: UpdateNoteRequest }) =>
      withToken((token) => updateNote(token, workspaceId, noteId, changes)),
    onSuccess: saved,
  });

  const act = useMutation({
    mutationFn: ({
      noteId,
      action,
    }: {
      noteId: string;
      action: "trash" | "restore" | "duplicate";
    }) => withToken((token) => noteAction(token, workspaceId, noteId, action)),
    onSuccess: (note) => {
      saved(note);
      // Backlinks leave out trashed notes, so every open note's links may change.
      void queryClient.invalidateQueries({ queryKey: [...noteKeys.all(workspaceId), "links"] });
    },
  });

  const remove = useMutation({
    mutationFn: (noteId: string) => withToken((token) => deleteNote(token, workspaceId, noteId)),
    onSuccess: (_result, noteId) => {
      removeCachedNote(queryClient, workspaceId, noteId);
      queryClient.removeQueries({ queryKey: noteKeys.detail(workspaceId, noteId) });
      refreshLists();
    },
  });

  const empty = useMutation({
    mutationFn: () => withToken((token) => emptyTrash(token, workspaceId)),
    onSuccess: refreshLists,
  });

  const opened = useMutation({
    mutationFn: (noteId: string) =>
      withToken((token) => markNoteOpened(token, workspaceId, noteId)),
    // The Recent view orders by it; nothing on screen depends on it otherwise.
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: noteKeys.lists(workspaceId),
        refetchType: "none",
      }),
  });

  const openJournal = useMutation({
    mutationFn: (date: string) => withToken((token) => openJournalEntry(token, workspaceId, date)),
    onSuccess: saved,
  });

  const updateDetail = (noteId: string, change: (note: Note) => Note) =>
    queryClient.setQueryData<Note>(noteKeys.detail(workspaceId, noteId), (note) =>
      note ? change(note) : note,
    );

  const addTag = useMutation({
    mutationFn: ({ noteId, name }: { noteId: string; name: string }) =>
      withToken((token) => addNoteTag(token, workspaceId, noteId, name)),
    onSuccess: ({ tags }, { noteId }) => {
      updateDetail(noteId, (note) => ({ ...note, tags }));
      refreshLists();
    },
  });

  const removeTag = useMutation({
    mutationFn: ({ noteId, tagId }: { noteId: string; tagId: string }) =>
      withToken((token) => removeNoteTag(token, workspaceId, noteId, tagId)),
    onSuccess: (_result, { noteId, tagId }) => {
      updateDetail(noteId, (note) => ({ ...note, tags: note.tags.filter((t) => t.id !== tagId) }));
      refreshLists();
    },
  });

  const linkTask = useMutation({
    mutationFn: ({ noteId, taskId }: { noteId: string; taskId: string }) =>
      withToken((token) => linkNoteTask(token, workspaceId, noteId, taskId)),
    onSuccess: (tasks, { noteId }) => {
      queryClient.setQueryData(noteKeys.tasks(workspaceId, noteId), tasks);
      updateDetail(noteId, (note) => ({ ...note, task_ids: tasks.tasks.map((t) => t.id) }));
      void queryClient.invalidateQueries({ queryKey: noteKeys.lists(workspaceId) });
    },
  });

  const unlinkTask = useMutation({
    mutationFn: ({ noteId, taskId }: { noteId: string; taskId: string }) =>
      withToken((token) => unlinkNoteTask(token, workspaceId, noteId, taskId)),
    onSuccess: (_result, { noteId, taskId }) => {
      void queryClient.invalidateQueries({ queryKey: noteKeys.tasks(workspaceId, noteId) });
      updateDetail(noteId, (note) => ({
        ...note,
        task_ids: note.task_ids.filter((id) => id !== taskId),
      }));
      void queryClient.invalidateQueries({ queryKey: noteKeys.lists(workspaceId) });
    },
  });

  const upload = useMutation({
    mutationFn: ({ noteId, file }: { noteId: string; file: File }) =>
      withToken((token) => uploadAttachment(token, workspaceId, noteId, file)),
    onSuccess: (_attachment, { noteId }) =>
      void queryClient.invalidateQueries({ queryKey: noteKeys.attachments(workspaceId, noteId) }),
  });

  const removeAttachment = useMutation({
    mutationFn: ({ noteId, attachmentId }: { noteId: string; attachmentId: string }) =>
      withToken((token) => deleteAttachment(token, workspaceId, noteId, attachmentId)),
    onSuccess: (_result, { noteId }) =>
      void queryClient.invalidateQueries({ queryKey: noteKeys.attachments(workspaceId, noteId) }),
  });

  return {
    create,
    update,
    act,
    remove,
    empty,
    opened,
    openJournal,
    addTag,
    removeTag,
    linkTask,
    unlinkTask,
    upload,
    removeAttachment,
  };
}

/** Folder and tag changes. Moving or deleting them can change which notes lists show. */
export function useNoteOrganizer(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: noteKeys.all(workspaceId) });
  };

  const createFolder = useMutation({
    mutationFn: (body: CreateNoteFolderRequest) =>
      withToken((token) => createNoteFolder(token, workspaceId, body)),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: noteKeys.folders(workspaceId) }),
  });
  const updateFolder = useMutation({
    mutationFn: ({ folderId, changes }: { folderId: string; changes: UpdateNoteFolderRequest }) =>
      withToken((token) => updateNoteFolder(token, workspaceId, folderId, changes)),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: noteKeys.folders(workspaceId) }),
  });
  const deleteFolder = useMutation({
    mutationFn: ({ folderId, mode }: { folderId: string; mode: FolderDeleteMode }) =>
      withToken((token) => deleteNoteFolder(token, workspaceId, folderId, mode)),
    onSuccess: refresh,
  });
  const rename = useMutation({
    mutationFn: ({ tagId, name }: { tagId: string; name: string }) =>
      withToken((token) => renameTag(token, workspaceId, tagId, name)),
    onSuccess: refresh,
  });
  const removeTag = useMutation({
    mutationFn: (tagId: string) => withToken((token) => deleteTag(token, workspaceId, tagId)),
    onSuccess: refresh,
  });

  return { createFolder, updateFolder, deleteFolder, renameTag: rename, deleteTag: removeTag };
}

/** Fetches an attachment's bytes with the user's token, for a download. */
export function useAttachmentDownload(workspaceId: string) {
  const { withToken } = useAuth();
  return useCallback(
    (noteId: string, attachmentId: string) =>
      withToken((token) => downloadAttachment(token, workspaceId, noteId, attachmentId)),
    [withToken, workspaceId],
  );
}
