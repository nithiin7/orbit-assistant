import { afterEach, describe, expect, it, vi } from "vitest";

import { type ApiError } from "../client";
import {
  deleteDocumentFolder,
  downloadDocumentFile,
  exportDocuments,
  linkDocument,
  uploadDocument,
} from "./requests";

const API = "http://localhost:8000/api/v1/workspaces/w1";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("document requests", () => {
  it("upload the file itself as the body, with its name and placement in the query", async () => {
    const fetchMock = stub(Response.json({}, { status: 201 }));
    const file = new File(["%PDF"], "My scan.pdf", { type: "application/pdf" });

    await uploadDocument("token", "w1", file, { folderId: "f1", categoryId: null });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/documents/upload?filename=My+scan.pdf&folder_id=f1`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(file);
    expect(init.headers).toMatchObject({ Authorization: "Bearer token" });
  });

  it("download the current file or a version, always with the token", async () => {
    const fetchMock = stub(new Response("bytes"));
    const blob = await downloadDocumentFile("token", "w1", "d1", "v 2");
    expect(blob.size).toBe(5);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/documents/d1/versions/v%202/file`);
    expect(init.headers).toMatchObject({ Authorization: "Bearer token" });

    const current = stub(new Response("now"));
    await downloadDocumentFile("token", "w1", "d1");
    expect(current.mock.calls[0]?.[0]).toBe(`${API}/documents/d1/file`);
  });

  it("surface the API's message when a download is refused", async () => {
    stub(Response.json({ detail: "Document not found." }, { status: 404 }));
    await expect(downloadDocumentFile("token", "w1", "d1")).rejects.toEqual(
      expect.objectContaining({ status: 404, detail: "Document not found." }) as ApiError,
    );
  });

  it("send folder deletion choices and links in the path and query", async () => {
    const fetchMock = stub(new Response(null, { status: 204 }));
    await deleteDocumentFolder("token", "w1", "f1", "folder", "f2");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${API}/document-folders/f1?documents=folder&target_id=f2`,
    );

    const linkMock = stub(new Response(null, { status: 204 }));
    await linkDocument("token", "w1", "d1", "recurring_payment", "r1");
    const [url, init] = linkMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/documents/d1/links/recurring_payment/r1`);
    expect(init.method).toBe("PUT");
  });

  it("export a selection as an archive", async () => {
    const fetchMock = stub(new Response("zip"));
    const blob = await exportDocuments("token", "w1", {
      document_ids: ["d1"],
      include_versions: true,
    });
    expect(blob.size).toBe(3);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ document_ids: ["d1"], include_versions: true });
  });
});
