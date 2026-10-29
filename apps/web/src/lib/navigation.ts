import {
  Bot,
  CalendarDays,
  CheckSquare,
  LayoutDashboard,
  type LucideIcon,
  NotebookPen,
  Settings,
  Wallet,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
};

/** Primary navigation. The single source of truth for sidebar links and section routes. */
export const navItems: readonly NavItem[] = [
  {
    title: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    description: "An overview of your day across Orbit.",
  },
  {
    title: "Tasks",
    href: "/tasks",
    icon: CheckSquare,
    description: "Plan and track what needs doing.",
  },
  {
    title: "Calendar",
    href: "/calendar",
    icon: CalendarDays,
    description: "See your schedule at a glance.",
  },
  {
    title: "Finance",
    href: "/finance",
    icon: Wallet,
    description: "Keep an eye on spending and budgets.",
  },
  {
    title: "Notes",
    href: "/notes",
    icon: NotebookPen,
    description: "Capture ideas and reference material.",
  },
  {
    title: "Assistant",
    href: "/assistant",
    icon: Bot,
    description: "Ask Orbit for help, privately.",
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
    description: "Configure Orbit to fit how you work.",
  },
];

/** Section routes rendered by the `[section]` placeholder page. */
export const sectionItems = navItems.filter((item) => item.href !== "/");

export function findSection(slug: string): NavItem | undefined {
  return sectionItems.find((item) => item.href === `/${slug}`);
}

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
