import type {
  DocumentCategory,
  DocumentDetail,
  DocumentFolder,
  DocumentOverview,
  DocumentSummary,
} from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { DocumentsPanel } from "./documents-view";

// The URL, as a tiny store: `router.push` changes it and the page re-renders, like Next.js.
const url = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  return {
    get: () => search,
    set: (next: unknown) => {
      if (typeof next !== "string") return;
      search = next.includes("?") ? next.slice(next.indexOf("?") + 1) : "";
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});
const push = vi.hoisted(() => vi.fn((href: string) => url.set(href)));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push }),
  usePathname: () => "/documents",
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(url.subscribe, url.get, url.get)),
}));

const WS = `/api/v1/workspaces/${personal.id}`;
const DOCS = `${WS}/documents`;

/** A local calendar date, as the page counts days in the viewer's time zone (not UTC). */
function daysFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const insurance: DocumentCategory = {
  id: "cccccccc-0000-4000-8000-000000000001",
  name: "Insurance",
  icon: "shield",
  position: 0,
  document_count: 1,
};

const garage: DocumentFolder = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  parent_id: null,
  name: "Garage",
  document_count: 1,
  created_at: "2026-10-01T09:00:00Z",
  updated_at: "2026-10-01T09:00:00Z",
};
const other: DocumentFolder = {
  ...garage,
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  name: "Archive box",
  document_count: 0,
};

function summary(overrides: Partial<DocumentSummary> & Pick<DocumentSummary, "id" | "title">) {
  return {
    workspace_id: personal.id,
    folder_id: null,
    category_id: null,
    description: "",
    issuing_authority: null,
    provider: null,
    issue_date: null,
    expiry_date: null,
    renewal_date: null,
    review_date: null,
    expiry_status: "none",
    is_favorite: false,
    state: "active",
    archived_at: null,
    trashed_at: null,
    file: null,
    version_count: 0,
    tags: [],
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
    last_opened_at: null,
    ...overrides,
  } satisfies DocumentSummary;
}

const policy = summary({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Car insurance",
  category_id: insurance.id,
  folder_id: garage.id,
  expiry_date: daysFromToday(5),
  expiry_status: "expiring",
  tags: ["Car"],
  version_count: 1,
  file: {
    version_id: "dddddddd-0000-4000-8000-000000000001",
    filename: "policy.docx",
    extension: "docx",
    content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size_bytes: 2048,
    uploaded_at: "2026-10-01T09:00:00Z",
  },
});
const passport = summary({ id: "aaaaaaaa-0000-4000-8000-000000000002", title: "Passport" });

function detailOf(document: DocumentSummary): DocumentDetail {
  return {
    document: {
      ...document,
      reference_number: "SECRET-1",
      effective_date: null,
      amount: null,
      currency: null,
      notes: "",
      custom_fields: [],
      reminder_days: [30, 7, 0],
      reminder_time: "09:00:00",
      timezone: "UTC",
    },
    versions: document.file
      ? [
          {
            id: document.file.version_id,
            number: 1,
            filename: document.file.filename,
            extension: document.file.extension,
            content_type: document.file.content_type,
            size_bytes: document.file.size_bytes,
            sha256: "0".repeat(64),
            note: "",
            restored_from: null,
            uploaded_at: document.file.uploaded_at,
            is_current: true,
          },
        ]
      : [],
    renewals: [],
    links: [
      {
        kind: "task",
        id: "eeeeeeee-0000-4000-8000-000000000001",
        title: "Renew insurance",
        detail: "Open",
        linked_at: "2026-10-01T09:00:00Z",
      },
    ],
    next_reminder_at: "2030-01-01T09:00:00Z",
  };
}

const counts = {
  all: 2,
  favorites: 0,
  unfiled: 1,
  unclassified: 1,
  without_file: 1,
  expiring_7: 1,
  expiring_30: 1,
  expiring_90: 1,
  expired: 0,
  renewals: 0,
  archived: 0,
  trashed: 0,
  total_bytes: 2048,
};

const overview: DocumentOverview = {
  counts,
  recently_added: [policy, passport],
  recently_updated: [policy, passport],
  favorites: [],
  expiring: [policy],
  expired: [],
  categories: [insurance],
};

type Handler = (request: MockRequest) => Response | Promise<Response>;

function routes(extra: Record<string, Handler> = {}) {
  return {
    "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
    "GET /api/v1/me": json(ada),
    "GET /api/v1/me/avatar": status(204),
    "GET /api/v1/workspaces": json({ workspaces: [personal] }),
    [`GET ${DOCS}`]: json({ documents: [policy, passport], total: 2 }),
    [`GET ${DOCS}/counts`]: json(counts),
    [`GET ${DOCS}/overview`]: json(overview),
    [`GET ${DOCS}/settings`]: json({
      max_bytes: 1024 * 1024,
      accepted_extensions: ["docx", "pdf", "png"],
    }),
    [`GET ${DOCS}/tags`]: json({ tags: [{ name: "Car", document_count: 1 }] }),
    [`GET ${WS}/document-folders`]: json({ folders: [garage, other] }),
    [`GET ${WS}/document-categories`]: json({ categories: [insurance] }),
    [`GET ${DOCS}/${policy.id}`]: json(detailOf(policy)),
    [`GET ${DOCS}/${passport.id}`]: json(detailOf(passport)),
    [`POST ${DOCS}/${policy.id}/open`]: status(204),
    [`POST ${DOCS}/${passport.id}/open`]: status(204),
    [`GET ${WS}/integrations/connections`]: json({ connections: [] }),
    ...extra,
  };
}

function calls(api: ReturnType<typeof mockApi>, method: string, path: string) {
  return api.mock.calls
    .map(([input, init]) => ({ url: new URL(String(input)), init }))
    .filter(({ url: u, init }) => (init?.method ?? "GET") === method && u.pathname === path);
}

async function renderDocuments(search = "") {
  url.set(`?${search}`);
  await renderSignedIn(<DocumentsPanel />);
}

beforeEach(() => {
  push.mockClear();
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:orbit"), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("DocumentsPanel", () => {
  it("opens on an overview of what needs attention", async () => {
    mockApi(routes());
    await renderDocuments();

    const soon = await screen.findByRole("region", { name: "Needs attention" });
    expect(within(soon).getByRole("button", { name: /Car insurance/ })).toHaveTextContent(
      "Expires in 5 days",
    );
    expect(screen.getByRole("button", { name: /Expiring in 30 days/ })).toHaveTextContent("1");
    const rail = screen.getAllByRole("navigation", { name: "Documents" })[0]!;
    expect(within(rail).getByRole("button", { name: /Garage, 1 document/ })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: /Insurance, 1 document/ })).toBeInTheDocument();
  });

  it("lists documents without their sensitive details and exports a selection", async () => {
    const user = userEvent.setup();
    const api = mockApi(routes({ [`POST ${DOCS}/export`]: () => new Response(new Blob(["zip"])) }));
    await renderDocuments("view=all");

    const list = await screen.findByRole("list", { name: "Documents" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Car insurance");
    expect(items[0]).toHaveTextContent("Insurance");
    expect(items[0]).toHaveTextContent("DOCX · 2 KB");
    expect(items[0]).toHaveTextContent("#Car");
    expect(items[1]).toHaveTextContent("No file");
    expect(list).not.toHaveTextContent("SECRET");

    await user.click(within(items[0]!).getByRole("checkbox", { name: "Select “Car insurance”" }));
    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(calls(api, "POST", `${DOCS}/export`)).toHaveLength(1));
    const [request] = calls(api, "POST", `${DOCS}/export`);
    expect(JSON.parse(String(request!.init?.body))).toEqual({
      document_ids: [policy.id],
      include_versions: true,
    });
  });

  it("uploads several files, refusing ones the server won't take before sending them", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const api = mockApi(
      routes({ [`POST ${DOCS}/upload`]: () => Response.json(detailOf(passport), { status: 201 }) }),
    );
    await renderDocuments("view=all");
    await screen.findByRole("list", { name: "Documents" });

    const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    await user.upload(input, [
      new File(["%PDF-1.7"], "scan.pdf", { type: "application/pdf" }),
      new File(["MZ"], "tool.exe"),
    ]);

    const uploads = await screen.findByRole("region", { name: "Uploads" });
    await waitFor(() =>
      expect(within(uploads).getByRole("status")).toHaveTextContent("1 of 2 uploaded"),
    );
    expect(uploads).toHaveTextContent("That type of file isn’t accepted");
    const sent = calls(api, "POST", `${DOCS}/upload`);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url.searchParams.get("filename")).toBe("scan.pdf");
  });

  it("shows a failed upload on the file, with a retry", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    mockApi(
      routes({
        [`POST ${DOCS}/upload`]: () => {
          attempts += 1;
          return attempts === 1
            ? Response.json(
                { detail: "The file's contents don't match its extension." },
                { status: 415 },
              )
            : Response.json(detailOf(passport), { status: 201 });
        },
      }),
    );
    await renderDocuments("view=all");
    await screen.findByRole("list", { name: "Documents" });
    const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    await user.upload(input, new File(["%PDF"], "scan.pdf", { type: "application/pdf" }));

    const uploads = await screen.findByRole("region", { name: "Uploads" });
    expect(await within(uploads).findByText(/contents don't match/)).toBeInTheDocument();
    await user.click(within(uploads).getByRole("button", { name: "Retry “scan.pdf”" }));
    await waitFor(() =>
      expect(within(uploads).getByRole("status")).toHaveTextContent("1 of 1 uploaded"),
    );
  });

  it("opens a document with its details, history, links, and reminders, and saves edits", async () => {
    const user = userEvent.setup();
    const api = mockApi(
      routes({
        [`PATCH ${DOCS}/${policy.id}`]: ({ body }) =>
          Response.json({
            ...detailOf(policy),
            document: { ...detailOf(policy).document, ...(body as object) },
          }),
      }),
    );
    await renderDocuments(`document=${policy.id}`);

    const pane = await screen.findByRole("article", { name: "Car insurance" });
    // Office files can't be previewed; they offer a download instead.
    expect(within(pane).getByText("No preview for DOCX files")).toBeInTheDocument();
    // The file fills the page; its details open only when asked for.
    expect(within(pane).queryByRole("tablist")).not.toBeInTheDocument();
    await user.click(within(pane).getByRole("button", { name: "Show details" }));
    const tab = (name: string) => user.click(within(pane).getByRole("tab", { name }));

    await tab("History");
    expect(within(pane).getByRole("region", { name: "Version history" })).toHaveTextContent(
      "policy.docx",
    );
    await tab("Links");
    expect(within(pane).getByRole("link", { name: /Renew insurance/ })).toHaveAttribute(
      "href",
      "/tasks?task=eeeeeeee-0000-4000-8000-000000000001",
    );
    await tab("Reminders");
    expect(within(pane).getByRole("button", { name: "30 days before" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(pane).getByText(/Next reminder/)).toBeInTheDocument();
    await user.click(within(pane).getByRole("button", { name: "15 days before" }));

    // Edits on one tab survive switching to another before saving.
    await tab("Details");
    const provider = within(pane).getByRole("textbox", { name: "Provider or organization" });
    await user.type(provider, "Shield Co");
    await user.click(within(pane).getByRole("button", { name: "Save details" }));

    await waitFor(() => expect(calls(api, "PATCH", `${DOCS}/${policy.id}`)).toHaveLength(1));
    const body = JSON.parse(
      String(calls(api, "PATCH", `${DOCS}/${policy.id}`)[0]!.init?.body),
    ) as Record<string, unknown>;
    expect(body.provider).toBe("Shield Co");
    expect(body.reference_number).toBe("SECRET-1");
    expect(body.reminder_days).toEqual([30, 15, 7, 0]);
    expect(body.expiry_date).toBe(policy.expiry_date);
  });

  it("moves documents to the Trash without deleting them", async () => {
    const user = userEvent.setup();
    const trashed = { ...passport, state: "trashed" as const, trashed_at: "2026-10-02T09:00:00Z" };
    const api = mockApi(
      routes({
        [`POST ${DOCS}/${passport.id}/trash`]: json(detailOf(trashed)),
        [`DELETE ${DOCS}/${passport.id}`]: status(204),
      }),
    );
    await renderDocuments("view=all");
    const list = await screen.findByRole("list", { name: "Documents" });
    await user.click(within(list).getByRole("button", { name: "More actions for “Passport”" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    await waitFor(() => expect(calls(api, "POST", `${DOCS}/${passport.id}/trash`)).toHaveLength(1));
    expect(calls(api, "DELETE", `${DOCS}/${passport.id}`)).toHaveLength(0);
  });

  it("asks before deleting a trashed document forever", async () => {
    const user = userEvent.setup();
    const trashed = { ...passport, state: "trashed" as const, trashed_at: "2026-10-02T09:00:00Z" };
    const api = mockApi(
      routes({
        [`GET ${DOCS}`]: json({ documents: [trashed], total: 1 }),
        [`DELETE ${DOCS}/${passport.id}`]: status(204),
      }),
    );
    await renderDocuments("view=trash");
    const list = await screen.findByRole("list", { name: "Documents" });
    await user.click(within(list).getByRole("button", { name: "More actions for “Passport”" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete forever…" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(calls(api, "DELETE", `${DOCS}/${passport.id}`)).toHaveLength(0);

    await user.click(within(list).getByRole("button", { name: "More actions for “Passport”" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete forever…" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete forever",
      }),
    );
    await waitFor(() => expect(calls(api, "DELETE", `${DOCS}/${passport.id}`)).toHaveLength(1));
  });

  it("deletes a folder without deleting its documents, moving them where the user chose", async () => {
    const user = userEvent.setup();
    const api = mockApi(routes({ [`DELETE ${WS}/document-folders/${garage.id}`]: status(204) }));
    await renderDocuments("view=all");
    const rail = (await screen.findAllByRole("navigation", { name: "Documents" }))[0]!;
    await user.click(await within(rail).findByRole("button", { name: "Actions for “Garage”" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete…" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete “Garage”?" });
    expect(dialog).toHaveTextContent("None are deleted");
    await user.click(
      within(dialog).getByRole("radio", { name: /Move its documents to another folder/ }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Delete folder" }));

    await waitFor(() =>
      expect(calls(api, "DELETE", `${WS}/document-folders/${garage.id}`)).toHaveLength(1),
    );
    const params = calls(api, "DELETE", `${WS}/document-folders/${garage.id}`)[0]!.url.searchParams;
    expect(params.get("documents")).toBe("folder");
    expect(params.get("target_id")).toBe(other.id);
  });

  it("explains what to do when there are no documents yet", async () => {
    mockApi(
      routes({
        [`GET ${DOCS}/overview`]: json({
          ...overview,
          counts: { ...counts, all: 0 },
          recently_added: [],
          recently_updated: [],
          expiring: [],
        }),
      }),
    );
    await renderDocuments();
    expect(
      await screen.findByRole("heading", { name: "Keep your important documents in one place" }),
    ).toBeInTheDocument();
  });
});

describe("Connected drives", () => {
  const drive = {
    id: "c1",
    workspace_id: personal.id,
    provider: "google",
    account_email: "ada@gmail.example",
    display_name: "Ada",
    capabilities: ["calendar", "files"],
    scopes: [],
    status: "active",
    mail_days: 30,
    last_synced_at: null,
    last_error: null,
    created_at: "2030-01-01T00:00:00Z",
  };
  const lease = {
    id: "f1",
    name: "Lease.pdf",
    folder: false,
    mime_type: "application/pdf",
    size: 2048,
    modified_at: null,
    url: "https://drive.google.com/file/d/f1",
    imported: null,
  };

  it("browses a drive from the rail and imports into the chosen folder", async () => {
    const user = userEvent.setup();
    const api = mockApi(
      routes({
        [`GET ${WS}/integrations/connections`]: json({ connections: [drive] }),
        [`GET ${WS}/integrations/connections/c1/files`]: json({ files: [lease], next_page: null }),
        [`POST ${WS}/integrations/connections/c1/files/f1/import`]: json(
          { document_id: "d1", title: "Lease", link: {} },
          201,
        ),
      }),
    );
    await renderDocuments();

    const rail = await screen.findByRole("navigation", { name: "Documents" });
    await user.click(await within(rail).findByRole("button", { name: "Google Drive" }));
    expect(push).toHaveBeenLastCalledWith("/documents?drive=c1");

    expect(await screen.findByRole("heading", { name: "Google Drive" })).toBeInTheDocument();
    expect(await screen.findByText("Lease.pdf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open “Lease.pdf” in Google Drive" })).toHaveAttribute(
      "href",
      lease.url,
    );
    await user.click(screen.getByRole("combobox", { name: "Import into folder" }));
    await user.click(await screen.findByRole("option", { name: "Garage" }));
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(
        calls(api, "POST", `${WS}/integrations/connections/c1/files/f1/import`).map(({ init }) =>
          JSON.parse(String(init?.body)),
        ),
      ).toEqual([{ folder_id: garage.id }]),
    );
  });

  it("says so when the drive is no longer connected", async () => {
    mockApi(routes());
    await renderDocuments("drive=gone");
    expect(await screen.findByText(/isn’t connected any more/)).toBeInTheDocument();
  });
});
