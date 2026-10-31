import type { Note } from "@orbit/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { useNoteAutosave } from "./use-note-autosave";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/notes",
}));

const NOTE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const NOTE_URL = `/api/v1/workspaces/${personal.id}/notes/${NOTE_ID}`;

const signedIn = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
  // The hook refreshes the note's links after each save.
  [`GET ${NOTE_URL}/links`]: json({ outgoing: [], backlinks: [] }),
};

const note: Note = {
  id: NOTE_ID,
  workspace_id: personal.id,
  folder_id: null,
  note_type: "note",
  title: "Plan",
  content: { type: "doc", content: [{ type: "paragraph" }] },
  content_format: "prosemirror-v1",
  journal_date: null,
  is_pinned: false,
  is_favorite: false,
  archived_at: null,
  trashed_at: null,
  revision: 1,
  created_at: "2026-10-01T09:00:00Z",
  updated_at: "2026-10-01T09:00:00Z",
  last_opened_at: null,
  tags: [],
  task_ids: [],
};

function Harness() {
  const autosave = useNoteAutosave(personal.id, note);
  return (
    <div>
      <p data-testid="status">{autosave.status}</p>
      <p data-testid="error">{autosave.error}</p>
      <button type="button" onClick={() => autosave.edit({ title: "Plan 1" })}>
        edit
      </button>
      <button type="button" onClick={() => autosave.edit({ title: "Typed later" })}>
        edit again
      </button>
      <button type="button" onClick={() => void autosave.flush()}>
        flush
      </button>
      <button type="button" onClick={autosave.retry}>
        retry
      </button>
      <button type="button" onClick={() => void autosave.resolveConflict("mine")}>
        keep mine
      </button>
    </div>
  );
}

/** A PATCH handler that echoes the change at the next revision, recording each body. */
function saving(bodies: unknown[], startRevision = 1) {
  let revision = startRevision;
  return ({ body }: MockRequest) => {
    bodies.push(body);
    revision += 1;
    return Response.json({ ...note, ...(body as object), revision });
  };
}

function patches(api: ReturnType<typeof mockApi>) {
  return api.mock.calls.filter(([, init]) => init?.method === "PATCH");
}

const statusText = () => screen.getByTestId("status").textContent;

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("useNoteAutosave", () => {
  it("saves after a pause in typing, with the revision it edited", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    const api = mockApi({ ...signedIn, [`PATCH ${NOTE_URL}`]: saving(bodies) });
    await renderSignedIn(<Harness />);

    expect(statusText()).toBe("saved");
    await user.click(screen.getByRole("button", { name: "edit" }));
    expect(statusText()).toBe("unsaved");
    // Nothing is sent while typing continues.
    expect(patches(api)).toHaveLength(0);

    await waitFor(() => expect(statusText()).toBe("saved"), { timeout: 2000 });
    expect(bodies).toEqual([{ expected_revision: 1, title: "Plan 1" }]);

    await user.click(screen.getByRole("button", { name: "edit again" }));
    await user.click(screen.getByRole("button", { name: "flush" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ expected_revision: 2, title: "Typed later" });
  });

  it("sends one request at a time and saves later edits afterwards", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    let release: () => void = () => undefined;
    const echo = saving(bodies);
    const api = mockApi({
      ...signedIn,
      [`PATCH ${NOTE_URL}`]: (request) =>
        bodies.length === 0
          ? new Promise<Response>((resolve) => {
              release = () => resolve(echo(request));
            })
          : echo(request),
    });
    await renderSignedIn(<Harness />);

    await user.click(screen.getByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: "flush" }));
    await waitFor(() => expect(statusText()).toBe("saving"));
    await user.click(screen.getByRole("button", { name: "edit again" }));
    await user.click(screen.getByRole("button", { name: "flush" }));
    // The second change waits for the first save.
    expect(patches(api)).toHaveLength(1);

    release();
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ expected_revision: 2, title: "Typed later" });
    await waitFor(() => expect(statusText()).toBe("saved"));
  });

  it("stops on a conflict instead of overwriting, and can keep this version", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    let conflicted = false;
    mockApi({
      ...signedIn,
      [`PATCH ${NOTE_URL}`]: (request) => {
        if (!conflicted) {
          conflicted = true;
          bodies.push(request.body);
          return Response.json(
            { detail: "This note was changed somewhere else." },
            { status: 409 },
          );
        }
        return saving(bodies, 5)(request);
      },
      [`GET ${NOTE_URL}`]: json({ ...note, title: "Their title", revision: 5 }),
    });
    await renderSignedIn(<Harness />);

    await user.click(screen.getByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: "flush" }));
    await waitFor(() => expect(statusText()).toBe("conflict"));

    // More typing doesn't try again on its own.
    await user.click(screen.getByRole("button", { name: "edit again" }));
    await user.click(screen.getByRole("button", { name: "flush" }));
    expect(bodies).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "keep mine" }));
    await waitFor(() => expect(statusText()).toBe("saved"));
    expect(bodies[1]).toMatchObject({ expected_revision: 5, title: "Typed later" });
  });

  it("retries a save that failed for a passing reason", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    let failures = 1;
    mockApi({
      ...signedIn,
      [`PATCH ${NOTE_URL}`]: (request) => {
        if (failures > 0) {
          failures -= 1;
          return Response.json({ detail: "The database is unavailable." }, { status: 503 });
        }
        return saving(bodies)(request);
      },
    });
    await renderSignedIn(<Harness />);

    await user.click(screen.getByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: "flush" }));
    await waitFor(() => expect(statusText()).toBe("retrying"));
    await waitFor(() => expect(statusText()).toBe("saved"), { timeout: 3000 });
    expect(bodies).toEqual([{ expected_revision: 1, title: "Plan 1" }]);
  });

  it("reports a save the server refused, and retries on request", async () => {
    const user = userEvent.setup();
    let refuse = true;
    const bodies: unknown[] = [];
    mockApi({
      ...signedIn,
      [`PATCH ${NOTE_URL}`]: (request) => {
        if (refuse) {
          refuse = false;
          return Response.json({ detail: "content is too long" }, { status: 422 });
        }
        return saving(bodies)(request);
      },
    });
    await renderSignedIn(<Harness />);

    await user.click(screen.getByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: "flush" }));
    await waitFor(() => expect(statusText()).toBe("error"));
    expect(screen.getByTestId("error")).toHaveTextContent("content is too long");

    await user.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() => expect(statusText()).toBe("saved"));
    expect(bodies).toHaveLength(1);
  });

  it("warns before leaving the page with unsaved changes", async () => {
    const user = userEvent.setup();
    mockApi({ ...signedIn, [`PATCH ${NOTE_URL}`]: saving([]) });
    await renderSignedIn(<Harness />);

    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await user.click(screen.getByRole("button", { name: "edit" }));
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe("useNoteAutosave without changes", () => {
  it("sends nothing when an edit leaves the note as the server has it", async () => {
    const user = userEvent.setup();
    const api = mockApi({ ...signedIn, [`PATCH ${NOTE_URL}`]: saving([]) });
    await renderSignedIn(<UnchangedHarness />);

    await user.click(screen.getByRole("button", { name: "same" }));
    await user.click(screen.getByRole("button", { name: "flush" }));
    await waitFor(() => expect(statusText()).toBe("saved"));
    expect(patches(api)).toHaveLength(0);
  });
});

function UnchangedHarness() {
  const autosave = useNoteAutosave(personal.id, note);
  return (
    <div>
      <p data-testid="status">{autosave.status}</p>
      <button type="button" onClick={() => autosave.edit({ content: note.content })}>
        same
      </button>
      <button type="button" onClick={() => void autosave.flush()}>
        flush
      </button>
    </div>
  );
}
