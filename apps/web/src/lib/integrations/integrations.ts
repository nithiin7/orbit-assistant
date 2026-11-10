import type {
  IntegrationCapability,
  IntegrationConnectionStatus,
  IntegrationEntityType,
  IntegrationProviderId,
  IntegrationSyncDirection,
  IntegrationSyncRun,
} from "@orbit/contracts";

import { documentsHref } from "@/lib/documents";
import { notesHref } from "@/lib/notes";
import type { Option } from "@/utils/common";

export const PROVIDER_NAMES: Readonly<Record<IntegrationProviderId, string>> = {
  google: "Google",
  microsoft: "Microsoft",
};

/** What each capability is called for each provider, so people recognize their own services. */
const CAPABILITY_NAMES: Readonly<
  Record<IntegrationProviderId, Record<IntegrationCapability, string>>
> = {
  google: {
    calendar: "Google Calendar",
    calendar_write: "Edit Google Calendar events",
    mail: "Gmail",
    files: "Google Drive",
  },
  microsoft: {
    calendar: "Outlook Calendar",
    calendar_write: "Edit Outlook events",
    mail: "Outlook Mail",
    files: "OneDrive",
  },
};

export function capabilityName(
  provider: IntegrationProviderId,
  capability: IntegrationCapability,
): string {
  return CAPABILITY_NAMES[provider][capability];
}

/** The services a provider brings, for summaries; editing events is part of the calendar. */
export const SERVICE_CAPABILITIES: readonly IntegrationCapability[] = ["calendar", "mail", "files"];

/** The capabilities offered when connecting, with sensible defaults (read-only calendars). */
export const DEFAULT_CAPABILITIES: readonly IntegrationCapability[] = ["calendar"];

export const STATUS_LABELS: Readonly<Record<IntegrationConnectionStatus, string>> = {
  active: "Connected",
  reauth_required: "Needs reconnecting",
  error: "Problem",
};

export const SYNC_INTERVALS: readonly Option<"0" | "15" | "30" | "60" | "360" | "1440">[] = [
  { value: "15", label: "Every 15 minutes" },
  { value: "30", label: "Every 30 minutes" },
  { value: "60", label: "Every hour" },
  { value: "360", label: "Every 6 hours" },
  { value: "1440", label: "Once a day" },
  { value: "0", label: "Only when I ask" },
];

export const DIRECTIONS: readonly Option<IntegrationSyncDirection>[] = [
  { value: "import", label: "Into Orbit only" },
  { value: "two_way", label: "Both ways" },
];

export const MAIL_PERIODS: readonly Option<"7" | "30" | "90" | "365">[] = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last year" },
];

const RUN_STATUS: Readonly<Record<IntegrationSyncRun["status"], string>> = {
  queued: "Waiting",
  running: "Synchronizing",
  succeeded: "Done",
  partial: "Done with problems",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function runStatusLabel(run: IntegrationSyncRun): string {
  if (run.status === "queued" && run.attempts > 0) return "Retrying soon";
  return RUN_STATUS[run.status];
}

/** A run's counts as a short sentence, leaving out zeros: "3 added, 1 updated". */
export function runSummary(run: IntegrationSyncRun): string {
  const parts: [number, string][] = [
    [run.imported, "added"],
    [run.updated, "updated"],
    [run.deleted, "removed"],
    [run.exported, "sent"],
    [run.conflicts, run.conflicts === 1 ? "conflict" : "conflicts"],
    [run.failed, "couldn’t be imported"],
  ];
  const text = parts
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(", ");
  if (text) return text;
  return run.status === "succeeded" ? "Up to date" : "";
}

export function runKindLabel(run: IntegrationSyncRun, calendarName: string | undefined): string {
  if (run.kind === "files") return "Imported files";
  return calendarName ?? "Calendar";
}

/** A file size for people: "820 KB", "3.4 MB". */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Just now", "12 min ago", "3 h ago", or a date, for the last synchronization. */
export function formatSynced(at: string | null, now: Date = new Date()): string {
  if (at === null) return "Not yet";
  const minutes = Math.round((now.getTime() - new Date(at).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Where the provider's consent page sends people back to; see the API's redirect URL. */
export const CALLBACK_PATH = "/integrations/callback";

/** The settings view of one connection. */
export function connectionHref(connectionId: string): string {
  return `/settings/integrations?connection=${encodeURIComponent(connectionId)}`;
}

/** The Tasks page with a connection's mail open beside it. */
export function inboxHref(connectionId: string): string {
  return `/tasks?inbox=${encodeURIComponent(connectionId)}`;
}

/** The Documents page browsing a connection's drive. */
export function driveHref(connectionId: string): string {
  return documentsHref({ driveId: connectionId });
}

/** Where an Orbit record made from an external one opens. */
export function linkedRecordHref(entityType: IntegrationEntityType, id: string): string {
  switch (entityType) {
    case "task":
      return `/tasks?task=${encodeURIComponent(id)}`;
    case "note":
      return notesHref({ noteId: id });
    case "document":
      return documentsHref({ documentId: id });
    case "reminder":
      return "/reminders";
    case "event":
      return "/calendar";
  }
}

export const ENTITY_LABELS: Readonly<Record<IntegrationEntityType, string>> = {
  task: "Task",
  note: "Note",
  reminder: "Reminder",
  document: "Document",
  event: "Event",
};
