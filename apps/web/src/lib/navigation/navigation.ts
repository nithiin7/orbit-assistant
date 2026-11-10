import {
  AlarmClock,
  Bot,
  CalendarDays,
  CheckSquare,
  Clapperboard,
  FileLock2,
  HeartPulse,
  LayoutDashboard,
  type LucideIcon,
  NotebookPen,
  Repeat2,
  Settings,
  ShoppingCart,
  Wallet,
  Workflow,
} from "lucide-react";

export type NavGroupId = "home" | "plan" | "track" | "library" | "ai" | "system";

export type NavGroup = {
  id: NavGroupId;
  /** Shown above the group's links; `null` for groups that need no heading. */
  label: string | null;
};

/** Sidebar sections, in order: what you do, what you track, what you keep, then AI help. */
export const navGroups: readonly NavGroup[] = [
  { id: "home", label: null },
  { id: "plan", label: "Plan" },
  { id: "track", label: "Track" },
  { id: "library", label: "Library" },
  { id: "ai", label: "AI" },
];

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
  /** The sidebar section it sits in; `system` items open from the profile menu instead. */
  group: NavGroupId;
};

/** Primary navigation, in sidebar order. The single source of truth for sidebar links and section routes. */
export const navItems: readonly NavItem[] = [
  {
    title: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    description: "An overview of your day across Orbit.",
    group: "home",
  },
  {
    title: "Tasks",
    href: "/tasks",
    icon: CheckSquare,
    description: "Plan and track what needs doing.",
    group: "plan",
  },
  {
    title: "Calendar",
    href: "/calendar",
    icon: CalendarDays,
    description: "Plan events, meetings, and time for your tasks.",
    group: "plan",
  },
  {
    title: "Reminders",
    href: "/reminders",
    icon: AlarmClock,
    description: "Get notified about tasks and anything else, once or on a schedule.",
    group: "plan",
  },
  {
    title: "Shopping",
    href: "/shopping",
    icon: ShoppingCart,
    description: "Track what to buy across your shopping lists.",
    group: "plan",
  },
  {
    title: "Habits",
    href: "/habits",
    icon: Repeat2,
    description: "Build habits and routines, and see how they add up.",
    group: "track",
  },
  {
    title: "Health",
    href: "/health",
    icon: HeartPulse,
    description: "Workouts, measurements, nutrition, activity, and fitness goals.",
    group: "track",
  },
  {
    title: "Finance",
    href: "/finance",
    icon: Wallet,
    description: "Track accounts, income, spending, and transfers.",
    group: "track",
  },
  {
    title: "Notes",
    href: "/notes",
    icon: NotebookPen,
    description: "Capture, organize, and connect your notes and journal.",
    group: "library",
  },
  {
    title: "Documents",
    href: "/documents",
    icon: FileLock2,
    description: "Store, organize, and find your important documents, and track when they expire.",
    group: "library",
  },
  {
    title: "Watchlist",
    href: "/watchlist",
    icon: Clapperboard,
    description: "Movies and series to watch, the ones you're watching, and what you thought.",
    group: "library",
  },
  {
    title: "Assistant",
    href: "/assistant",
    icon: Bot,
    description: "Ask Orbit for help, privately.",
    group: "ai",
  },
  {
    title: "Automation",
    href: "/automation",
    icon: Workflow,
    description: "Your personal agent, workflows, and approvals.",
    group: "ai",
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
    description: "Configure Orbit to fit how you work.",
    group: "system",
  },
];

/** The sidebar's sections, each with its links. */
export const sidebarSections = navGroups
  .map((group) => ({ ...group, items: navItems.filter((item) => item.group === group.id) }))
  .filter((section) => section.items.length > 0);

/** Routes with their own page; every other item is rendered by the `[section]` placeholder. */
const dedicatedRoutes: ReadonlySet<string> = new Set([
  "/",
  "/tasks",
  "/reminders",
  "/shopping",
  "/calendar",
  "/habits",
  "/health",
  "/finance",
  "/notes",
  "/documents",
  "/watchlist",
  "/assistant",
  "/automation",
  "/settings",
]);

/** Section routes rendered by the `[section]` placeholder page. */
export const sectionItems = navItems.filter((item) => !dedicatedRoutes.has(item.href));

export function findSection(slug: string): NavItem | undefined {
  return sectionItems.find((item) => item.href === `/${slug}`);
}

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
