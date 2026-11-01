import {
  AlarmClock,
  Bot,
  CalendarDays,
  CheckSquare,
  FileLock2,
  LayoutDashboard,
  type LucideIcon,
  NotebookPen,
  Repeat2,
  Settings,
  ShoppingCart,
  Wallet,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
  /** `workspace` items lead the sidebar; `system` items sit apart at its foot. */
  group: "workspace" | "system";
};

/** Primary navigation. The single source of truth for sidebar links and section routes. */
export const navItems: readonly NavItem[] = [
  {
    title: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    description: "An overview of your day across Orbit.",
    group: "workspace",
  },
  {
    title: "Tasks",
    href: "/tasks",
    icon: CheckSquare,
    description: "Plan and track what needs doing.",
    group: "workspace",
  },
  {
    title: "Reminders",
    href: "/reminders",
    icon: AlarmClock,
    description: "Get notified about tasks and anything else, once or on a schedule.",
    group: "workspace",
  },
  {
    title: "Shopping",
    href: "/shopping",
    icon: ShoppingCart,
    description: "Track what to buy across your shopping lists.",
    group: "workspace",
  },
  {
    title: "Calendar",
    href: "/calendar",
    icon: CalendarDays,
    description: "Plan events, meetings, and time for your tasks.",
    group: "workspace",
  },
  {
    title: "Habits",
    href: "/habits",
    icon: Repeat2,
    description: "Build habits and routines, and see how they add up.",
    group: "workspace",
  },
  {
    title: "Finance",
    href: "/finance",
    icon: Wallet,
    description: "Track accounts, income, spending, and transfers.",
    group: "workspace",
  },
  {
    title: "Notes",
    href: "/notes",
    icon: NotebookPen,
    description: "Capture, organize, and connect your notes and journal.",
    group: "workspace",
  },
  {
    title: "Documents",
    href: "/documents",
    icon: FileLock2,
    description: "Store, organize, and find your important documents, and track when they expire.",
    group: "workspace",
  },
  {
    title: "Assistant",
    href: "/assistant",
    icon: Bot,
    description: "Ask Orbit for help, privately.",
    group: "workspace",
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
    description: "Configure Orbit to fit how you work.",
    group: "system",
  },
];

/** Routes with their own page; every other item is rendered by the `[section]` placeholder. */
const dedicatedRoutes: ReadonlySet<string> = new Set([
  "/",
  "/tasks",
  "/reminders",
  "/shopping",
  "/calendar",
  "/habits",
  "/finance",
  "/notes",
  "/documents",
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
