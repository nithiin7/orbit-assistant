import type { DocumentRecord } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  describeExpiry,
  detailsValues,
  documentDetailsSchema,
  documentsHref,
  fileKindOf,
  formatFileSize,
  linkedRecordHref,
  parseDocumentsLocation,
  previewKind,
  toDocumentListQuery,
  toUpdateRequest,
} from "./documents";

const FOLDER = "bbbbbbbb-0000-4000-8000-000000000001";

function location(search: string) {
  return parseDocumentsLocation(new URLSearchParams(search));
}

describe("documents location", () => {
  it("defaults to the overview and round-trips views, folders, and filters", () => {
    expect(location("").view).toBe("overview");
    expect(location("view=bogus").view).toBe("overview");
    expect(location("q=tax").view).toBe("all");
    const expiring = location("view=expiring&within=7&kind=pdf");
    expect(expiring).toMatchObject({ view: "expiring", window: 7, fileKind: "pdf" });
    expect(documentsHref(expiring)).toBe("/documents?view=expiring&within=7&kind=pdf");
    const folder = location(`folder=${FOLDER.toUpperCase()}&view=trash`);
    expect(folder).toMatchObject({ view: "all", folderId: FOLDER });
    expect(documentsHref({ folderId: FOLDER, documentId: FOLDER })).toBe(
      `/documents?folder=${FOLDER}&document=${FOLDER}`,
    );
    // Malformed IDs are ignored rather than sent to the API.
    expect(location("folder=../etc&document=x").folderId).toBeNull();
    expect(location("within=12&view=expiring").window).toBe(30);
    // A connected drive replaces the library view, and its ID must be a plain token.
    expect(location("drive=c1").driveId).toBe("c1");
    expect(documentsHref({ driveId: "c1", view: "trash" })).toBe("/documents?drive=c1");
    expect(location("drive=../x").driveId).toBeNull();
  });

  it("maps views to list queries", () => {
    expect(toDocumentListQuery(location("view=expiring&within=90"), "title")).toMatchObject({
      expires_within: 90,
      sort: "expiry",
      order: "asc",
    });
    expect(toDocumentListQuery(location("view=expired"), "title")).toMatchObject({
      expired: true,
    });
    expect(toDocumentListQuery(location("view=trash"), "updated")).toMatchObject({
      state: "trashed",
    });
    expect(toDocumentListQuery(location(`folder=${FOLDER}&q=rc`), "size", 2)).toEqual({
      sort: "size",
      limit: 50,
      offset: 100,
      q: "rc",
      folder_id: FOLDER,
    });
    expect(toDocumentListQuery(location("tag=Car"), "updated")).toMatchObject({ tag: "Car" });
  });
});

describe("file helpers", () => {
  it("formats sizes", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(25 * 1024 * 1024)).toBe("25 MB");
  });

  it("previews only safe, renderable types", () => {
    expect(previewKind({ content_type: "application/pdf" })).toBe("pdf");
    expect(previewKind({ content_type: "image/png" })).toBe("image");
    expect(previewKind({ content_type: "text/csv" })).toBe("text");
    expect(previewKind({ content_type: "image/svg+xml" })).toBeNull();
    expect(previewKind({ content_type: "text/html" })).toBeNull();
    expect(fileKindOf({ extension: "docx" })).toBe("office");
    expect(fileKindOf(null)).toBe("none");
  });
});

describe("describeExpiry", () => {
  const today = "2030-01-10";
  it("describes how soon a date is", () => {
    expect(describeExpiry(null, "none", today)).toBeNull();
    expect(describeExpiry("2030-01-10", "expiring", today)?.label).toBe("Expires today");
    expect(describeExpiry("2030-01-11", "expiring", today)?.label).toBe("Expires tomorrow");
    expect(describeExpiry("2030-01-15", "expiring", today)?.label).toBe("Expires in 5 days");
    expect(describeExpiry("2030-01-09", "expired", today)?.label).toBe("Expired yesterday");
    expect(describeExpiry("2029-12-31", "expired", today)?.label).toBe("Expired 10 days ago");
    expect(describeExpiry("2031-06-01", "valid", today)?.label).toMatch(/^Expires /);
  });
});

describe("linkedRecordHref", () => {
  it("opens each kind where it lives", () => {
    const id = "aaaaaaaa-0000-4000-8000-000000000001";
    expect(linkedRecordHref({ kind: "note", id, detail: "Note" })).toBe(`/notes?note=${id}`);
    expect(linkedRecordHref({ kind: "task", id, detail: "Open" })).toBe(`/tasks?task=${id}`);
    expect(linkedRecordHref({ kind: "event", id, detail: "2030-01-14" })).toBe(
      "/calendar?view=day&date=2030-01-14",
    );
    expect(linkedRecordHref({ kind: "recurring_payment", id, detail: "Bill" })).toBe(
      "/finance?view=bills",
    );
    expect(linkedRecordHref({ kind: "loan", id, detail: "Bank" })).toBe("/finance?view=loans");
  });
});

const record: DocumentRecord = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  workspace_id: "0d1c0ffe-2222-4c2b-9e57-000000000001",
  title: "Policy",
  folder_id: null,
  category_id: null,
  description: "",
  issuing_authority: null,
  provider: "Acme",
  issue_date: "2030-01-01",
  expiry_date: "2031-01-01",
  renewal_date: null,
  review_date: null,
  expiry_status: "valid",
  is_favorite: false,
  state: "active",
  archived_at: null,
  trashed_at: null,
  file: null,
  version_count: 0,
  tags: [],
  created_at: "2030-01-01T09:00:00Z",
  updated_at: "2030-01-01T09:00:00Z",
  last_opened_at: null,
  reference_number: "P-1",
  effective_date: null,
  amount: 1250050,
  currency: "INR",
  notes: "",
  custom_fields: [{ label: "Type", value: "Comprehensive" }],
  reminder_days: [30, 7, 0],
  reminder_time: "09:00:00",
  timezone: "UTC",
};

describe("the details form", () => {
  it("round-trips a document into an update, clearing blanks", () => {
    const values = detailsValues(record);
    expect(values.amount).toBe("12,500.50");
    const update = toUpdateRequest({
      ...values,
      provider: "  ",
      reference_number: "",
      custom_fields: [...values.custom_fields, { label: " ", value: "dropped" }],
      reminder_days: [0, 30, 30],
    });
    expect(update).toMatchObject({
      title: "Policy",
      provider: null,
      reference_number: null,
      amount: 1250050,
      currency: "INR",
      custom_fields: [{ label: "Type", value: "Comprehensive" }],
      reminder_days: [30, 0],
    });
    expect(toUpdateRequest({ ...values, amount: "" })).toMatchObject({
      amount: null,
      currency: null,
    });
  });

  it("validates dates and amounts like the API", async () => {
    const values = detailsValues(record);
    await expect(documentDetailsSchema.validate(values)).resolves.toBeTruthy();
    await expect(
      documentDetailsSchema.validate({ ...values, expiry_date: "2029-01-01" }),
    ).rejects.toThrow("can’t be before");
    await expect(documentDetailsSchema.validate({ ...values, amount: "abc" })).rejects.toThrow(
      "Enter an amount",
    );
    await expect(documentDetailsSchema.validate({ ...values, title: " " })).rejects.toThrow(
      "Enter a name",
    );
  });
});
