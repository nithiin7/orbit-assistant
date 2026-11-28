import type { SystemStatus, UpdateStatus } from "@orbit/contracts";

export type UpdateNotice = {
  tone: "brand" | "success" | "warning" | "muted";
  title: string;
  detail: string;
};

/** "just now", "12 min ago", "3 h ago", "2 days ago", for when something last happened. */
export function formatAgo(at: string, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - new Date(at).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  const days = Math.round(minutes / (24 * 60));
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** What the update card says, from the server's answer. */
export function describeUpdate(status: UpdateStatus, now: Date = new Date()): UpdateNotice {
  const current = `You’re running Orbit ${status.current_version}.`;
  if (!status.enabled) {
    return { tone: "muted", title: "Update checks are off", detail: current };
  }
  const checked = status.checked_at ? `Checked ${formatAgo(status.checked_at, now)}.` : "";
  if (status.update_available && status.latest_version) {
    return {
      tone: "brand",
      title: `Orbit ${status.latest_version} is available`,
      detail: `${current} ${status.check_failed ? "" : checked}`.trim(),
    };
  }
  if (status.check_failed) {
    const when = status.checked_at ? ` ${formatAgo(status.checked_at, now)}` : "";
    return {
      tone: "warning",
      title: "Couldn’t reach GitHub",
      detail: `The last check${when} failed. Orbit tries again in an hour. ${current}`,
    };
  }
  if (status.checked_at === null) {
    return { tone: "muted", title: "Not checked yet", detail: current };
  }
  return { tone: "success", title: "You’re up to date", detail: `${current} ${checked}` };
}

type FeatureKey = keyof SystemStatus["features"];

/** The server's optional features, in the order the status page lists them. */
export const systemFeatures: readonly { key: FeatureKey; label: string }[] = [
  { key: "ai", label: "AI" },
  { key: "agent", label: "Personal agent" },
  { key: "web_push", label: "Push notifications" },
  { key: "google", label: "Google" },
  { key: "microsoft", label: "Microsoft" },
  { key: "online_maps", label: "Online maps" },
];

export function storageLabel(mode: SystemStatus["storage_mode"]): string {
  return mode === "local" ? "Local (SQLite)" : "Cloud (Supabase PostgreSQL)";
}

/** The deployment guide's upgrade steps for the repository the server follows. */
export function upgradeGuideUrl(repository: string): string {
  return `https://github.com/${repository}/blob/main/docs/deployment.md#upgrading`;
}
