import type {
  DocumentFile,
  DocumentFileKind,
  DocumentLink,
  DocumentLinkKind,
  DocumentListQuery,
  DocumentRecord,
  DocumentSort,
  ExpiryStatus,
  UpdateDocumentRequest,
} from "@orbit/contracts";
import { array, mixed, number, object, string } from "yup";

import { CURRENCIES, formatMoney, parseAmount } from "@/lib/finance";
import type { Option } from "@/utils/common";
import { formatCalendarDate } from "@/utils/dates";
import { multiLineText, singleLineText } from "@/utils/validation";

/** The Documents page's fixed views. Folders, categories, and tags narrow "all". */
export type DocumentView =
  | "overview"
  | "all"
  | "recent"
  | "favorites"
  | "expiring"
  | "expired"
  | "renewals"
  | "archived"
  | "trash";

export const DOCUMENT_VIEWS: readonly { id: DocumentView; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "all", label: "All documents" },
  { id: "recent", label: "Recent" },
  { id: "favorites", label: "Favorites" },
  { id: "expiring", label: "Expiring soon" },
  { id: "expired", label: "Expired" },
  { id: "renewals", label: "Renewals" },
  { id: "archived", label: "Archived" },
  { id: "trash", label: "Trash" },
];

const VIEW_IDS: ReadonlySet<string> = new Set(DOCUMENT_VIEWS.map((view) => view.id));

/** How far ahead "Expiring soon" looks. */
export const EXPIRY_WINDOWS = [7, 30, 90] as const;
export type ExpiryWindow = (typeof EXPIRY_WINDOWS)[number];
export const DEFAULT_EXPIRY_WINDOW: ExpiryWindow = 30;

export const FILE_KINDS: readonly Option<DocumentFileKind>[] = [
  { value: "pdf", label: "PDF" },
  { value: "image", label: "Images" },
  { value: "office", label: "Office files" },
  { value: "text", label: "Text and CSV" },
  { value: "none", label: "No file yet" },
];

/** What the Documents page shows, as kept in its URL. */
export type DocumentsLocation = {
  view: DocumentView;
  folderId: string | null;
  categoryId: string | null;
  tag: string | null;
  /** The open document. */
  documentId: string | null;
  search: string;
  fileKind: DocumentFileKind | null;
  window: ExpiryWindow;
  /** A connected account whose drive is being browsed, in place of Orbit's documents. */
  driveId: string | null;
};

export const DOCUMENTS_PATH = "/documents";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idParam(value: string | null): string | null {
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

/** Connection IDs are opaque; accept only a short, plain token. */
function tokenParam(value: string | null): string | null {
  return value && /^[\w-]{1,64}$/.test(value) ? value : null;
}

function isFileKind(value: string | null): value is DocumentFileKind {
  return FILE_KINDS.some((kind) => kind.value === value);
}

export function parseDocumentsLocation(params: Pick<URLSearchParams, "get">): DocumentsLocation {
  const folderId = idParam(params.get("folder"));
  const categoryId = folderId ? null : idParam(params.get("category"));
  const tag = folderId || categoryId ? null : (params.get("tag")?.trim().slice(0, 50) ?? null);
  const view = params.get("view");
  const kind = params.get("kind");
  const window = Number(params.get("within"));
  const narrowed = Boolean(folderId || categoryId || tag);
  const search = (params.get("q") ?? "").slice(0, 200);
  return {
    view: narrowed
      ? "all"
      : view && VIEW_IDS.has(view)
        ? (view as DocumentView)
        : search
          ? "all"
          : "overview",
    folderId,
    categoryId,
    tag: tag || null,
    documentId: idParam(params.get("document")),
    search,
    fileKind: isFileKind(kind) ? kind : null,
    window: EXPIRY_WINDOWS.find((value) => value === window) ?? DEFAULT_EXPIRY_WINDOW,
    driveId: tokenParam(params.get("drive")),
  };
}

export function documentsHref(location: Partial<DocumentsLocation>): string {
  const params = new URLSearchParams();
  if (location.driveId) {
    params.set("drive", location.driveId);
    return `${DOCUMENTS_PATH}?${params.toString()}`;
  }
  if (location.folderId) params.set("folder", location.folderId);
  else if (location.categoryId) params.set("category", location.categoryId);
  else if (location.tag) params.set("tag", location.tag);
  else if (location.view && location.view !== "overview") params.set("view", location.view);
  if (location.view === "expiring" && location.window && location.window !== 30) {
    params.set("within", String(location.window));
  }
  if (location.fileKind) params.set("kind", location.fileKind);
  if (location.search?.trim()) params.set("q", location.search.trim());
  if (location.documentId) params.set("document", location.documentId);
  const query = params.toString();
  return query ? `${DOCUMENTS_PATH}?${query}` : DOCUMENTS_PATH;
}

export const DOCUMENT_SORTS: readonly Option<DocumentSort>[] = [
  { value: "updated", label: "Last modified" },
  { value: "created", label: "Date added" },
  { value: "title", label: "Name" },
  { value: "expiry", label: "Expiry date" },
  { value: "size", label: "File size" },
  { value: "category", label: "Category" },
];

export const DOCUMENTS_PAGE_SIZE = 50;

/** The list query for a location (not the overview, which has its own endpoint). */
export function toDocumentListQuery(
  location: DocumentsLocation,
  sort: DocumentSort,
  page = 0,
): DocumentListQuery {
  const query: DocumentListQuery = {
    sort,
    limit: DOCUMENTS_PAGE_SIZE,
    offset: page * DOCUMENTS_PAGE_SIZE,
  };
  const search = location.search.trim();
  if (search) query.q = search;
  if (location.fileKind) query.file_kind = location.fileKind;
  if (location.folderId) return { ...query, folder_id: location.folderId };
  if (location.categoryId) return { ...query, category_id: location.categoryId };
  if (location.tag) return { ...query, tag: location.tag };
  switch (location.view) {
    case "overview":
    case "all":
      return query;
    case "recent":
      return { ...query, sort: "recent", limit: 30, offset: 0 };
    case "favorites":
      return { ...query, favorite: true };
    case "expiring":
      return { ...query, expires_within: location.window, sort: "expiry", order: "asc" };
    case "expired":
      return { ...query, expired: true, sort: "expiry", order: "desc" };
    case "renewals":
      return { ...query, renewal_within: 90 };
    case "archived":
      return { ...query, state: "archived" };
    case "trash":
      return { ...query, state: "trashed" };
  }
}

const SIZE_UNITS = ["KB", "MB", "GB"] as const;

/** `1536` → `1.5 KB`. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")} ${SIZE_UNITS[unit]}`;
}

export type PreviewKind = "pdf" | "image" | "text" | null;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const TEXT_TYPES = new Set(["text/plain", "text/csv"]);

/** How a file can be shown in the app; `null` for files that can only be downloaded. */
export function previewKind(file: Pick<DocumentFile, "content_type">): PreviewKind {
  if (file.content_type === "application/pdf") return "pdf";
  if (IMAGE_TYPES.has(file.content_type)) return "image";
  if (TEXT_TYPES.has(file.content_type)) return "text";
  return null;
}

export function fileKindOf(file: Pick<DocumentFile, "extension"> | null): DocumentFileKind {
  if (!file) return "none";
  switch (file.extension) {
    case "pdf":
      return "pdf";
    case "jpg":
    case "jpeg":
    case "png":
    case "webp":
      return "image";
    case "txt":
    case "csv":
      return "text";
    default:
      return "office";
  }
}

/** Whole days from `today` to `date` (both `YYYY-MM-DD`); negative when it's past. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
}

export type ExpiryDescription = { status: ExpiryStatus; label: string };

/** "Expires in 5 days", "Expired yesterday", "Expires 12 Mar 2031", or `null` without a date. */
export function describeExpiry(
  expiryDate: string | null,
  status: ExpiryStatus,
  today: string,
): ExpiryDescription | null {
  if (!expiryDate) return null;
  const days = daysUntil(expiryDate, today);
  if (days < 0) {
    const ago = -days;
    return {
      status,
      label:
        ago === 1
          ? "Expired yesterday"
          : ago <= 60
            ? `Expired ${ago} days ago`
            : `Expired ${formatCalendarDate(expiryDate)}`,
    };
  }
  if (days === 0) return { status, label: "Expires today" };
  if (days === 1) return { status, label: "Expires tomorrow" };
  if (days <= 60) return { status, label: `Expires in ${days} days` };
  return { status, label: `Expires ${formatCalendarDate(expiryDate)}` };
}

/** Days before a date that reminders can be set for, most useful first. */
export const REMINDER_DAY_CHOICES = [90, 60, 30, 15, 7, 3, 1, 0] as const;

export function reminderDayLabel(days: number): string {
  if (days === 0) return "On the day";
  if (days === 1) return "1 day before";
  return `${days} days before`;
}

export const LINK_KINDS: readonly { kind: DocumentLinkKind; label: string; plural: string }[] = [
  { kind: "task", label: "Task", plural: "Tasks" },
  { kind: "note", label: "Note", plural: "Notes" },
  { kind: "event", label: "Event", plural: "Events" },
  { kind: "transaction", label: "Transaction", plural: "Transactions" },
  { kind: "loan", label: "Loan", plural: "Loans" },
  { kind: "recurring_payment", label: "Subscription or bill", plural: "Subscriptions and bills" },
  { kind: "deposit", label: "Deposit", plural: "Deposits" },
  { kind: "holding", label: "Investment", plural: "Investments" },
  { kind: "asset", label: "Asset", plural: "Assets" },
];

export function linkKindLabel(kind: DocumentLinkKind): string {
  return LINK_KINDS.find((item) => item.kind === kind)?.label ?? kind;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Where a linked record opens in Orbit. */
export function linkedRecordHref(link: Pick<DocumentLink, "kind" | "id" | "detail">): string {
  const id = encodeURIComponent(link.id);
  switch (link.kind) {
    case "note":
      return `/notes?note=${id}`;
    case "task":
      return `/tasks?task=${id}`;
    case "event":
      // The detail is the event's first day; the calendar opens on it.
      return ISO_DATE.test(link.detail) ? `/calendar?view=day&date=${link.detail}` : "/calendar";
    case "transaction":
      return "/finance?view=transactions";
    case "loan":
      return "/finance?view=loans";
    case "recurring_payment":
      return link.detail === "Bill" ? "/finance?view=bills" : "/finance?view=subscriptions";
    case "deposit":
    case "holding":
      return "/finance?view=investments";
    case "asset":
      return "/finance?view=assets";
  }
}

// The details form

export const TITLE_MAX_LENGTH = 200;

const optionalDate = string().defined();

export const documentDetailsSchema = object({
  title: singleLineText(TITLE_MAX_LENGTH).required("Enter a name."),
  description: multiLineText(2000),
  reference_number: singleLineText(100),
  issuing_authority: singleLineText(200),
  provider: singleLineText(200),
  issue_date: optionalDate,
  effective_date: optionalDate,
  expiry_date: optionalDate.test(
    "after-issue",
    "The expiry date can’t be before the issue date.",
    (value, context) => {
      const issue: unknown = context.parent.issue_date;
      return !value || typeof issue !== "string" || !issue || value >= issue;
    },
  ),
  renewal_date: optionalDate,
  review_date: optionalDate,
  currency: mixed<(typeof CURRENCIES)[number]>()
    .oneOf([...CURRENCIES])
    .defined(),
  amount: string()
    .defined()
    .test("amount", "Enter an amount, like 1,250.50.", (value, context) => {
      if (!value.trim()) return true;
      const currency: unknown = context.parent.currency;
      return (
        typeof currency === "string" &&
        CURRENCIES.some((code) => code === currency) &&
        parseAmount(value, currency as (typeof CURRENCIES)[number]) !== null
      );
    }),
  notes: multiLineText(10_000),
  custom_fields: array(
    object({
      label: singleLineText(50).required("Name this detail."),
      value: singleLineText(500),
    }),
  )
    .max(20, "Use 20 extra details or fewer.")
    .defined(),
  reminder_days: array(number().integer().min(0).max(365).defined()).max(6).defined(),
});

export type DocumentDetailsValues = {
  title: string;
  description: string;
  reference_number: string;
  issuing_authority: string;
  provider: string;
  issue_date: string;
  effective_date: string;
  expiry_date: string;
  renewal_date: string;
  review_date: string;
  currency: (typeof CURRENCIES)[number];
  amount: string;
  notes: string;
  custom_fields: { label: string; value: string }[];
  reminder_days: number[];
};

function amountText(document: DocumentRecord): string {
  if (document.amount === null || !document.currency) return "";
  return formatMoney(document.amount, document.currency).replace(/[^\d.,]/g, "");
}

export function detailsValues(document: DocumentRecord): DocumentDetailsValues {
  return {
    title: document.title,
    description: document.description,
    reference_number: document.reference_number ?? "",
    issuing_authority: document.issuing_authority ?? "",
    provider: document.provider ?? "",
    issue_date: document.issue_date ?? "",
    effective_date: document.effective_date ?? "",
    expiry_date: document.expiry_date ?? "",
    renewal_date: document.renewal_date ?? "",
    review_date: document.review_date ?? "",
    currency: document.currency ?? "INR",
    amount: amountText(document),
    notes: document.notes,
    custom_fields: document.custom_fields.map((field) => ({ ...field })),
    reminder_days: [...document.reminder_days],
  };
}

const blank = (value: string) => value.trim() || null;

/** The form's values as an update. Blank optional fields clear them. */
export function toUpdateRequest(values: DocumentDetailsValues): UpdateDocumentRequest {
  const amount = values.amount.trim() ? parseAmount(values.amount, values.currency) : null;
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    reference_number: blank(values.reference_number),
    issuing_authority: blank(values.issuing_authority),
    provider: blank(values.provider),
    issue_date: values.issue_date || null,
    effective_date: values.effective_date || null,
    expiry_date: values.expiry_date || null,
    renewal_date: values.renewal_date || null,
    review_date: values.review_date || null,
    amount,
    currency: amount === null ? null : values.currency,
    notes: values.notes.trim(),
    custom_fields: values.custom_fields
      .map((field) => ({ label: field.label.trim(), value: field.value.trim() }))
      .filter((field) => field.label),
    reminder_days: [...new Set(values.reminder_days)].sort((a, b) => b - a),
  };
}

/** A document without a file: a name and, optionally, where it goes and when it expires. */
export const newDocumentSchema = object({
  title: singleLineText(TITLE_MAX_LENGTH).required("Enter a name."),
  categoryId: string().defined(),
  folderId: string().defined(),
  expiryDate: string().defined(),
});

export const categorySchema = object({
  name: singleLineText(50).required("Enter a name."),
  icon: string().defined(),
});

export const renewSchema = object({
  expiryDate: string().defined(),
  issueDate: string()
    .defined()
    .test("before-expiry", "The issue date can’t be after the expiry date.", (value, context) => {
      const expiry: unknown = context.parent.expiryDate;
      return !value || typeof expiry !== "string" || !expiry || value <= expiry;
    }),
  note: multiLineText(500),
});
