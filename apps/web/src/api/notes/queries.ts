import type { Note, NoteList, NoteListQuery, NoteSummary } from "@orbit/contracts";
import { type QueryClient, queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import {
  getNote,
  getNoteCounts,
  getNoteLinks,
  listAttachments,
  listNoteFolders,
  listNotes,
  listNoteTasks,
  listTags,
} from "./requests";

/**
 * Cache keys for a workspace's notes. Every key starts with the workspace ID, so one workspace's
 * notes can never be served for another. `null` (no active workspace yet) never fetches.
 */
export const noteKeys = {
  /** Everything cached for the workspace's notes. */
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "notes"] as const,
  lists: (workspaceId: string | null) => [...noteKeys.all(workspaceId), "list"] as const,
  list: (workspaceId: string | null, query: NoteListQuery) =>
    [...noteKeys.lists(workspaceId), query] as const,
  counts: (workspaceId: string | null) => [...noteKeys.all(workspaceId), "counts"] as const,
  details: (workspaceId: string | null) => [...noteKeys.all(workspaceId), "detail"] as const,
  detail: (workspaceId: string | null, noteId: string) =>
    [...noteKeys.details(workspaceId), noteId] as const,
  links: (workspaceId: string | null, noteId: string) =>
    [...noteKeys.all(workspaceId), "links", noteId] as const,
  tasks: (workspaceId: string | null, noteId: string) =>
    [...noteKeys.all(workspaceId), "tasks", noteId] as const,
  attachments: (workspaceId: string | null, noteId: string) =>
    [...noteKeys.all(workspaceId), "attachments", noteId] as const,
  folders: (workspaceId: string | null) => [...noteKeys.all(workspaceId), "folders"] as const,
  tags: (workspaceId: string | null) => [...noteKeys.all(workspaceId), "tags"] as const,
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

export function noteListOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: NoteListQuery,
) {
  return queryOptions({
    queryKey: noteKeys.list(workspaceId, query),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      listNotes(token, id, query, { signal }),
    ),
  });
}

export function noteCountsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: noteKeys.counts(workspaceId),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      getNoteCounts(token, id, { signal }),
    ),
  });
}

export function noteOptions(withToken: WithToken, workspaceId: string | null, noteId: string) {
  return queryOptions({
    queryKey: noteKeys.detail(workspaceId, noteId),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      getNote(token, id, noteId, { signal }),
    ),
    // The editor owns the note while it's open; refetching would fight unsaved typing.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function noteLinksOptions(withToken: WithToken, workspaceId: string | null, noteId: string) {
  return queryOptions({
    queryKey: noteKeys.links(workspaceId, noteId),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      getNoteLinks(token, id, noteId, { signal }),
    ),
  });
}

export function noteTasksOptions(withToken: WithToken, workspaceId: string | null, noteId: string) {
  return queryOptions({
    queryKey: noteKeys.tasks(workspaceId, noteId),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      listNoteTasks(token, id, noteId, { signal }),
    ),
  });
}

export function attachmentsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  noteId: string,
) {
  return queryOptions({
    queryKey: noteKeys.attachments(workspaceId, noteId),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      listAttachments(token, id, noteId, { signal }),
    ),
  });
}

export function noteFoldersOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: noteKeys.folders(workspaceId),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      listNoteFolders(token, id, { signal }),
    ),
  });
}

export function tagsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: noteKeys.tags(workspaceId),
    queryFn: withWorkspace(withToken, workspaceId, (token, id, signal) =>
      listTags(token, id, { signal }),
    ),
  });
}

/** A note as it appears in lists: the detail without its document. */
export function toNoteSummary(note: Note, excerpt: string): NoteSummary {
  const { content: _content, content_format: _format, task_ids: _tasks, ...fields } = note;
  return { ...fields, excerpt };
}

/** Show a saved note in every cached list that contains it, keeping each item's excerpt. */
export function replaceCachedNote(queryClient: QueryClient, workspaceId: string, note: Note) {
  queryClient.setQueryData(noteKeys.detail(workspaceId, note.id), note);
  queryClient.setQueriesData<NoteList>({ queryKey: noteKeys.lists(workspaceId) }, (list) =>
    list && list.notes.some((item) => item.id === note.id)
      ? {
          ...list,
          notes: list.notes.map((item) =>
            item.id === note.id ? toNoteSummary(note, item.excerpt) : item,
          ),
        }
      : list,
  );
}

/** Drop a note from every cached list, without refetching. */
export function removeCachedNote(queryClient: QueryClient, workspaceId: string, noteId: string) {
  queryClient.setQueriesData<NoteList>({ queryKey: noteKeys.lists(workspaceId) }, (list) => {
    if (!list?.notes.some((item) => item.id === noteId)) return list;
    return {
      notes: list.notes.filter((item) => item.id !== noteId),
      total: Math.max(0, list.total - 1),
    };
  });
}
