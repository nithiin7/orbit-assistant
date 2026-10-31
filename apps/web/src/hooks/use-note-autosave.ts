"use client";

import type { Note, NoteContent, UpdateNoteRequest } from "@orbit/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, describeApiError } from "@/api/client";
import { getNote, noteKeys, replaceCachedNote, updateNote } from "@/api/notes";
import { useAuth } from "@/providers/auth";

/** How long typing must pause before a save. */
export const AUTOSAVE_DELAY_MS = 800;
/** Waits before retrying a save that failed for a reason that may pass (network, 5xx). */
export const RETRY_DELAYS_MS = [1_000, 3_000, 8_000] as const;

export type SaveStatus =
  /** The server has everything typed so far. */
  | "saved"
  /** Changes wait for a pause in typing. */
  | "unsaved"
  | "saving"
  /** A save failed and will be retried shortly. */
  | "retrying"
  /** Saving failed and won't be retried automatically; `retry` tries again. */
  | "error"
  /** The note was changed elsewhere; nothing is saved until the user chooses a version. */
  | "conflict";

export type NoteEdit = { title?: string; content?: NoteContent };

type Field = "title" | "content";

export type NoteAutosave = {
  status: SaveStatus;
  /** Why the last save failed, for `error`. */
  error: string | null;
  /** Record an edit; it is saved after a pause. */
  edit: (changes: NoteEdit) => void;
  /** Save now. Resolves `true` once the server has every change, `false` if it couldn't. */
  flush: () => Promise<boolean>;
  retry: () => void;
  /** Settle a conflict by saving this version over the other ("mine"), or by loading the
   *  other ("theirs", which resolves to the note to show). */
  resolveConflict: (choice: "mine" | "theirs") => Promise<Note | null>;
};

function isRetryable(error: unknown): boolean {
  // Network failures aren't ApiErrors; 5xx (including the database being unavailable) may pass.
  return !(error instanceof ApiError) || error.status >= 500 || error.status === 429;
}

/**
 * Saves a note's title and content as the user types. Never reports `saved` before the server
 * confirms, sends at most one request at a time (later edits wait and go in the next one), and
 * includes the revision it last saved, so a change made in another tab or device is never
 * silently overwritten: the API refuses with 409 and this reports `conflict` instead.
 */
export function useNoteAutosave(workspaceId: string, note: Note): NoteAutosave {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);

  const noteId = note.id;
  // What the user sees, what the server last confirmed, and which fields differ.
  const local = useRef({ title: note.title, content: note.content });
  // What the server last confirmed, to skip saves that would change nothing.
  const confirmed = useRef({ title: note.title, content: JSON.stringify(note.content) });
  const revision = useRef(note.revision);
  const dirty = useRef(new Set<Field>());
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<number | null>(null);
  const attempt = useRef(0);
  const conflicted = useRef(false);
  const statusRef = useRef<SaveStatus>("saved");

  const show = useCallback((next: SaveStatus, message: string | null = null) => {
    statusRef.current = next;
    setStatus(next);
    setError(message);
  }, []);

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const saveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));

  const schedule = useCallback((delay: number) => {
    clearTimer();
    timer.current = window.setTimeout(() => void saveRef.current(), delay);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    clearTimer();
    if (conflicted.current) return false;
    if (inFlight.current) {
      // Wait for the save in progress, then send whatever changed meanwhile.
      await inFlight.current;
      return saveRef.current();
    }
    if (dirty.current.size === 0) return true;

    const sent = { title: local.current.title, content: JSON.stringify(local.current.content) };
    const fields = [...dirty.current].filter((field) => sent[field] !== confirmed.current[field]);
    dirty.current = new Set();
    if (fields.length === 0) {
      // Edited back to what the server has, or the editor only normalized the document.
      show("saved");
      return true;
    }
    const body: UpdateNoteRequest = { expected_revision: revision.current };
    if (fields.includes("title")) body.title = local.current.title;
    if (fields.includes("content")) body.content = local.current.content;
    show("saving");

    const request = (async () => {
      try {
        const saved = await withToken((token) => updateNote(token, workspaceId, noteId, body));
        revision.current = saved.revision;
        confirmed.current = {
          title: fields.includes("title") ? sent.title : confirmed.current.title,
          content: fields.includes("content") ? sent.content : confirmed.current.content,
        };
        attempt.current = 0;
        // Keep what the user typed meanwhile; the cache gets the server's copy of the rest.
        replaceCachedNote(queryClient, workspaceId, {
          ...saved,
          title: local.current.title,
          content: local.current.content,
        });
        void queryClient.invalidateQueries({ queryKey: noteKeys.links(workspaceId, noteId) });
        if (dirty.current.size > 0) {
          show("unsaved");
          schedule(AUTOSAVE_DELAY_MS);
        } else {
          show("saved");
        }
        return true;
      } catch (reason) {
        for (const field of fields) dirty.current.add(field);
        if (reason instanceof ApiError && reason.status === 409) {
          conflicted.current = true;
          show("conflict", describeApiError(reason, "This note was changed elsewhere."));
        } else if (isRetryable(reason) && attempt.current < RETRY_DELAYS_MS.length) {
          show("retrying", describeApiError(reason, "Couldn’t save. Retrying…"));
          schedule(RETRY_DELAYS_MS[attempt.current] ?? AUTOSAVE_DELAY_MS);
          attempt.current += 1;
        } else {
          show("error", describeApiError(reason, "Couldn’t save this note."));
        }
        return false;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = request;
    return request;
  }, [noteId, queryClient, schedule, show, withToken, workspaceId]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const edit = useCallback(
    (changes: NoteEdit) => {
      if (changes.title !== undefined && changes.title !== local.current.title) {
        local.current = { ...local.current, title: changes.title };
        dirty.current.add("title");
      }
      if (changes.content !== undefined) {
        local.current = { ...local.current, content: changes.content };
        dirty.current.add("content");
      }
      if (dirty.current.size === 0 || conflicted.current) return;
      attempt.current = 0;
      if (statusRef.current !== "saving") show("unsaved");
      schedule(AUTOSAVE_DELAY_MS);
    },
    [schedule, show],
  );

  const flush = useCallback(() => saveRef.current(), []);

  const retry = useCallback(() => {
    attempt.current = 0;
    void saveRef.current();
  }, []);

  const resolveConflict = useCallback(
    async (choice: "mine" | "theirs"): Promise<Note | null> => {
      let latest: Note;
      try {
        latest = await withToken((token) => getNote(token, workspaceId, noteId));
      } catch (reason) {
        show("conflict", describeApiError(reason, "Couldn’t load the latest version."));
        return null;
      }
      conflicted.current = false;
      revision.current = latest.revision;
      confirmed.current = { title: latest.title, content: JSON.stringify(latest.content) };
      if (choice === "theirs") {
        local.current = { title: latest.title, content: latest.content };
        dirty.current = new Set();
        replaceCachedNote(queryClient, workspaceId, latest);
        show("saved");
        return latest;
      }
      dirty.current = new Set(["title", "content"]);
      await saveRef.current();
      return null;
    },
    [noteId, queryClient, show, withToken, workspaceId],
  );

  // Warn before closing or reloading the tab with changes the server doesn't have yet.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (statusRef.current === "saved") return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Leaving the note (another note, another page) sends what's pending right away. The request
  // outlives this component, and its result still lands in the cache.
  useEffect(
    () => () => {
      if (dirty.current.size > 0 && !conflicted.current) void saveRef.current();
      else clearTimer();
    },
    [],
  );

  return { status, error, edit, flush, retry, resolveConflict };
}
