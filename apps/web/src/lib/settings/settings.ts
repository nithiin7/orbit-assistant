import {
  Activity,
  Archive,
  AudioLines,
  Bell,
  Bookmark,
  Bot,
  Clapperboard,
  Database,
  Layers,
  LineChart,
  LockKeyhole,
  type LucideIcon,
  MapPinned,
  Palette,
  Plug,
  UserRound,
} from "lucide-react";

/** Icon colours; the names match `IconChip` tones. */
export type SettingsTone =
  "brand" | "blue" | "green" | "amber" | "violet" | "teal" | "orange" | "rose" | "slate";

/** Where a panel sits in the settings menu. `account` opens from the profile row. */
export type SettingsSection = "account" | "workspace" | "modules" | "assistant" | "data";

export type SettingsPanel = {
  slug: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tone: SettingsTone;
  section: SettingsSection;
  /** Other words people search the menu with, e.g. "dark" for Appearance. */
  keywords?: readonly string[];
};

/** The menu's groups, in order, with their visible labels. */
export const settingsSections: readonly { value: SettingsSection; label: string }[] = [
  { value: "workspace", label: "Workspace" },
  { value: "modules", label: "Modules" },
  { value: "assistant", label: "Assistant" },
  { value: "data", label: "Your data" },
];

export function settingsSectionLabel(section: SettingsSection): string {
  if (section === "account") return "Account";
  return settingsSections.find((option) => option.value === section)?.label ?? "Settings";
}

/** Settings sub-pages. The single source of truth for the settings menu and its routes. */
export const settingsPanels: readonly SettingsPanel[] = [
  {
    slug: "account",
    title: "Account",
    description: "Profile, sign-in, and time zone.",
    icon: UserRound,
    tone: "brand",
    section: "account",
    keywords: ["profile", "photo", "password", "sign out", "time zone"],
  },
  {
    slug: "workspaces",
    title: "Workspaces",
    description: "Switch, rename, or create workspaces.",
    icon: Layers,
    tone: "slate",
    section: "workspace",
    keywords: ["switch", "rename", "new workspace"],
  },
  {
    slug: "appearance",
    title: "Appearance",
    description: "Mode, colors, and font for this browser.",
    icon: Palette,
    tone: "rose",
    section: "workspace",
    keywords: ["theme", "dark", "light", "mode", "color", "font", "sidebar"],
  },
  {
    slug: "notifications",
    title: "Notifications",
    description: "Push notifications on your devices.",
    icon: Bell,
    tone: "amber",
    section: "workspace",
    keywords: ["push", "alerts", "briefing"],
  },
  {
    slug: "finance",
    title: "Finance",
    description: "Live prices for your investments.",
    icon: LineChart,
    tone: "green",
    section: "modules",
    keywords: ["prices", "stocks", "mutual funds", "nav"],
  },
  {
    slug: "watchlist",
    title: "Watchlist",
    description: "Posters and details for movies and series.",
    icon: Clapperboard,
    tone: "orange",
    section: "modules",
    keywords: ["tmdb", "movies", "posters"],
  },
  {
    slug: "saved",
    title: "Saved",
    description: "Link previews: names, descriptions, images, and icons.",
    icon: Bookmark,
    tone: "blue",
    section: "modules",
    keywords: ["bookmarks", "links", "previews"],
  },
  {
    slug: "places",
    title: "Places",
    description: "Online maps and place search.",
    icon: MapPinned,
    tone: "teal",
    section: "modules",
    keywords: ["maps", "search", "nominatim"],
  },
  {
    slug: "integrations",
    title: "Integrations",
    description: "Google and Microsoft calendars, mail, and files.",
    icon: Plug,
    tone: "blue",
    section: "modules",
    keywords: ["google", "microsoft", "outlook", "calendar", "mail", "drive"],
  },
  {
    slug: "ai",
    title: "AI",
    description: "Providers, models, and privacy.",
    icon: Bot,
    tone: "violet",
    section: "assistant",
    keywords: ["openai", "anthropic", "gemini", "ollama", "model", "provider"],
  },
  {
    slug: "voice",
    title: "Voice",
    description: "Talking with Orbit: speech, languages, and privacy.",
    icon: AudioLines,
    tone: "brand",
    section: "assistant",
    keywords: ["speech", "microphone", "language"],
  },
  {
    slug: "app-lock",
    title: "App lock",
    description: "A PIN, Touch ID, or Windows Hello after Orbit sits idle.",
    icon: LockKeyhole,
    tone: "violet",
    section: "data",
    keywords: ["security", "pin", "passcode", "touch id", "fingerprint", "windows hello", "idle"],
  },
  {
    slug: "backup",
    title: "Backup & restore",
    description: "Back up, restore, and export your data.",
    icon: Archive,
    tone: "green",
    section: "data",
    keywords: ["export", "restore", "download"],
  },
  {
    slug: "storage",
    title: "Storage",
    description: "Where your data is stored.",
    icon: Database,
    tone: "slate",
    section: "data",
    keywords: ["database", "sqlite", "supabase", "location"],
  },
  {
    slug: "system",
    title: "System",
    description: "Version, updates, and server health.",
    icon: Activity,
    tone: "teal",
    section: "data",
    keywords: ["update", "version", "release", "health", "status", "worker", "migrate"],
  },
];

export function settingsHref(slug: string): string {
  return `/settings/${slug}`;
}

/** Whether a panel matches a menu search, by title, description, or keyword. */
export function matchesSettingsQuery(panel: SettingsPanel, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [panel.title, panel.description, ...(panel.keywords ?? [])].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

export function findSettingsPanel(slug: string): SettingsPanel | undefined {
  return settingsPanels.find((panel) => panel.slug === slug);
}

/**
 * A panel's stack of sections. Narrow panels stack them; as the panel's container widens they
 * flow into balanced columns, so wide screens are filled without stretching any one form.
 * Mark a section `[column-span:all]` to keep it full width.
 */
export const settingsSectionsClassName =
  "space-y-6 *:break-inside-avoid @5xl/panel:columns-2 @5xl/panel:gap-6 @min-[110rem]/panel:columns-3 @min-[110rem]/panel:gap-8";
