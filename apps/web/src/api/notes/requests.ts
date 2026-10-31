import type {
  CreateNoteFolderRequest,
  CreateNoteRequest,
  FolderDeleteMode,
  Note,
  NoteAttachment,
  NoteAttachmentList,
  NoteConnections,
  NoteCounts,
  NoteFolder,
  NoteFolderList,
  NoteList,
  NoteListQuery,
  NoteTagList,
  Tag,
  TagList,
  TaskList,
  UpdateNoteFolderRequest,
  UpdateNoteRequest,
} from "@orbit/contracts";

import { request, send, type Signal, toQueryString, workspacePath } from "../client";

function notesPath(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/notes${suffix}`);
}

function notePath(workspaceId: string, noteId: string, suffix = ""): string {
  return notesPath(workspaceId, `/${encodeURIComponent(noteId)}${suffix}`);
}

// Notes

export function listNotes(
  token: string,
  workspaceId: string,
  query: NoteListQuery = {},
  { signal }: Signal = {},
): Promise<NoteList> {
  return request<NoteList>(`${notesPath(workspaceId)}${toQueryString(query)}`, { token, signal });
}

export function getNoteCounts(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<NoteCounts> {
  return request<NoteCounts>(notesPath(workspaceId, "/counts"), { token, signal });
}

export function getNote(
  token: string,
  workspaceId: string,
  noteId: string,
  { signal }: Signal = {},
): Promise<Note> {
  return request<Note>(notePath(workspaceId, noteId), { token, signal });
}

export function createNote(
  token: string,
  workspaceId: string,
  body: CreateNoteRequest,
): Promise<Note> {
  return request<Note>(notesPath(workspaceId), { method: "POST", body, token });
}

/** Send `expected_revision` with title or content changes; a newer save makes this a 409. */
export function updateNote(
  token: string,
  workspaceId: string,
  noteId: string,
  body: UpdateNoteRequest,
  { signal }: Signal = {},
): Promise<Note> {
  return request<Note>(notePath(workspaceId, noteId), { method: "PATCH", body, token, signal });
}

export function markNoteOpened(token: string, workspaceId: string, noteId: string): Promise<void> {
  return request<void>(notePath(workspaceId, noteId, "/open"), { method: "POST", token });
}

export type NoteAction = "trash" | "restore" | "duplicate";

export function noteAction(
  token: string,
  workspaceId: string,
  noteId: string,
  action: NoteAction,
): Promise<Note> {
  return request<Note>(notePath(workspaceId, noteId, `/${action}`), { method: "POST", token });
}

/** Permanent; only for notes in the trash. */
export function deleteNote(token: string, workspaceId: string, noteId: string): Promise<void> {
  return request<void>(notePath(workspaceId, noteId), { method: "DELETE", token });
}

export function emptyTrash(token: string, workspaceId: string): Promise<{ deleted: number }> {
  return request<{ deleted: number }>(notesPath(workspaceId, "/empty-trash"), {
    method: "POST",
    token,
  });
}

export function getNoteLinks(
  token: string,
  workspaceId: string,
  noteId: string,
  { signal }: Signal = {},
): Promise<NoteConnections> {
  return request<NoteConnections>(notePath(workspaceId, noteId, "/links"), { token, signal });
}

// Journal

/** The entry for `date` (`YYYY-MM-DD`), created the first time it's opened. */
export function openJournalEntry(token: string, workspaceId: string, date: string): Promise<Note> {
  return request<Note>(notesPath(workspaceId, `/journal/${encodeURIComponent(date)}`), {
    method: "PUT",
    token,
  });
}

// Tags on a note

export function addNoteTag(
  token: string,
  workspaceId: string,
  noteId: string,
  name: string,
): Promise<NoteTagList> {
  return request<NoteTagList>(notePath(workspaceId, noteId, "/tags"), {
    method: "POST",
    body: { name },
    token,
  });
}

export function removeNoteTag(
  token: string,
  workspaceId: string,
  noteId: string,
  tagId: string,
): Promise<void> {
  return request<void>(notePath(workspaceId, noteId, `/tags/${encodeURIComponent(tagId)}`), {
    method: "DELETE",
    token,
  });
}

// Tasks on a note

export function listNoteTasks(
  token: string,
  workspaceId: string,
  noteId: string,
  { signal }: Signal = {},
): Promise<TaskList> {
  return request<TaskList>(notePath(workspaceId, noteId, "/tasks"), { token, signal });
}

export function linkNoteTask(
  token: string,
  workspaceId: string,
  noteId: string,
  taskId: string,
): Promise<TaskList> {
  return request<TaskList>(notePath(workspaceId, noteId, `/tasks/${encodeURIComponent(taskId)}`), {
    method: "PUT",
    token,
  });
}

export function unlinkNoteTask(
  token: string,
  workspaceId: string,
  noteId: string,
  taskId: string,
): Promise<void> {
  return request<void>(notePath(workspaceId, noteId, `/tasks/${encodeURIComponent(taskId)}`), {
    method: "DELETE",
    token,
  });
}

// Attachments

export function listAttachments(
  token: string,
  workspaceId: string,
  noteId: string,
  { signal }: Signal = {},
): Promise<NoteAttachmentList> {
  return request<NoteAttachmentList>(notePath(workspaceId, noteId, "/attachments"), {
    token,
    signal,
  });
}

/** Upload a file as the request body; the API decides its type from the name and contents. */
export function uploadAttachment(
  token: string,
  workspaceId: string,
  noteId: string,
  file: File,
): Promise<NoteAttachment> {
  const query = toQueryString({ filename: file.name });
  return request<NoteAttachment>(notePath(workspaceId, noteId, `/attachments${query}`), {
    method: "POST",
    body: file,
    token,
  });
}

/** The file's bytes. The API requires a bearer token, so a plain link can't download it. */
export async function downloadAttachment(
  token: string,
  workspaceId: string,
  noteId: string,
  attachmentId: string,
): Promise<Blob> {
  const response = await send(
    notePath(workspaceId, noteId, `/attachments/${encodeURIComponent(attachmentId)}`),
    { token },
  );
  return response.blob();
}

export function deleteAttachment(
  token: string,
  workspaceId: string,
  noteId: string,
  attachmentId: string,
): Promise<void> {
  return request<void>(
    notePath(workspaceId, noteId, `/attachments/${encodeURIComponent(attachmentId)}`),
    { method: "DELETE", token },
  );
}

// Folders

function foldersPath(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/note-folders${suffix}`);
}

export function listNoteFolders(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<NoteFolderList> {
  return request<NoteFolderList>(foldersPath(workspaceId), { token, signal });
}

export function createNoteFolder(
  token: string,
  workspaceId: string,
  body: CreateNoteFolderRequest,
): Promise<NoteFolder> {
  return request<NoteFolder>(foldersPath(workspaceId), { method: "POST", body, token });
}

export function updateNoteFolder(
  token: string,
  workspaceId: string,
  folderId: string,
  body: UpdateNoteFolderRequest,
): Promise<NoteFolder> {
  return request<NoteFolder>(foldersPath(workspaceId, `/${encodeURIComponent(folderId)}`), {
    method: "PATCH",
    body,
    token,
  });
}

export function deleteNoteFolder(
  token: string,
  workspaceId: string,
  folderId: string,
  notes: FolderDeleteMode,
): Promise<void> {
  const path = foldersPath(workspaceId, `/${encodeURIComponent(folderId)}`);
  return request<void>(`${path}${toQueryString({ notes })}`, { method: "DELETE", token });
}

// Tags

function tagsPath(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/note-tags${suffix}`);
}

export function listTags(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<TagList> {
  return request<TagList>(tagsPath(workspaceId), { token, signal });
}

export function renameTag(
  token: string,
  workspaceId: string,
  tagId: string,
  name: string,
): Promise<Tag> {
  return request<Tag>(tagsPath(workspaceId, `/${encodeURIComponent(tagId)}`), {
    method: "PATCH",
    body: { name },
    token,
  });
}

export function deleteTag(token: string, workspaceId: string, tagId: string): Promise<void> {
  return request<void>(tagsPath(workspaceId, `/${encodeURIComponent(tagId)}`), {
    method: "DELETE",
    token,
  });
}
