import type { RemoteFile } from "@orbit/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { connection, INTEGRATIONS } from "@/test/integrations";
import { renderSignedIn } from "@/test/session";

import { FileBrowser } from "./file-browser";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/integrations",
  useSearchParams: () => new URLSearchParams(),
}));

const FILES = `${INTEGRATIONS}/connections/c1/files`;
const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

function file(overrides: Partial<RemoteFile>): RemoteFile {
  return {
    id: "f1",
    name: "Lease.pdf",
    folder: false,
    mime_type: "application/pdf",
    size: 2048,
    modified_at: null,
    url: null,
    imported: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FileBrowser", () => {
  it("opens folders and imports a file into Documents", async () => {
    const user = userEvent.setup();
    let listings = 0;
    const fetchMock = mockApi({
      ...session,
      // The root first, then the folder that was opened.
      [`GET ${FILES}`]: () => {
        listings += 1;
        const files =
          listings === 1
            ? [file({ id: "dir", name: "Taxes", folder: true, size: null })]
            : [file({})];
        return Response.json({ files, next_page: null });
      },
      [`POST ${FILES}/f1/import`]: json({ document_id: "d1", title: "Lease", link: {} }, 201),
    });
    await renderSignedIn(<FileBrowser connection={connection()} />);
    await user.click(await screen.findByRole("button", { name: "Taxes" }));
    expect(await screen.findByText("Lease.pdf")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Folder" })).toHaveTextContent("Google Drive");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("folder_id=dir"))).toBe(true);
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => init?.method === "POST" && String(url).endsWith("/files/f1/import"),
        ),
      ).toBe(true),
    );
  });

  it("marks imported files and offers their new version", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      ...session,
      [`GET ${FILES}`]: json({
        files: [
          file({
            imported: {
              id: "l1",
              connection_id: "c1",
              external_kind: "file",
              external_id: "f1",
              entity_type: "document",
              entity_id: "d1",
              origin: "external",
              title: "Lease.pdf",
              external_url: null,
              status: "update_available",
              conflict_kind: null,
              conflict_detected_at: null,
              last_synced_at: null,
            },
          }),
        ],
        next_page: null,
      }),
      [`POST ${FILES}/links/l1/update`]: json({ document_id: "d1", title: "Lease", link: {} }),
    });
    await renderSignedIn(<FileBrowser connection={connection()} />);
    expect(await screen.findByText(/Changed since you imported it/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "In Documents" })).toHaveAttribute(
      "href",
      expect.stringContaining("d1"),
    );
    await user.click(screen.getByRole("button", { name: "Import new version" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/links/l1/update"))).toBe(
        true,
      ),
    );
  });
});
