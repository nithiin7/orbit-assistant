"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Tooltip } from "@/components/ui/tooltip";
import { isActivePath, type NavItem, navItems } from "@/lib/navigation";
import { cn } from "@/utils/common";

import { useSidebarCollapsed } from "./sidebar-state";

type NavLinksProps = {
  onNavigate?: () => void;
  /** In the desktop sidebar: labels fade out and tooltips take over when it is collapsed. */
  collapsible?: boolean;
};

const workspaceItems = navItems.filter((item) => item.group === "workspace");
const systemItems = navItems.filter((item) => item.group === "system");

export function NavLinks({ onNavigate, collapsible = false }: NavLinksProps) {
  const pathname = usePathname();
  const collapsed = useSidebarCollapsed() && collapsible;

  const renderItems = (items: readonly NavItem[]) =>
    items.map(({ title, href, icon: Icon }) => {
      const active = isActivePath(pathname, href);
      return (
        <li key={href}>
          <Tooltip label={title} disabled={!collapsed}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-9 items-center gap-3 overflow-hidden rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 outline-none",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                "focus-visible:ring-2 focus-visible:ring-ring",
                // Active indicator: a short accent bar on the leading edge.
                "before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-brand before:opacity-0 before:transition-opacity before:duration-150",
                active && "bg-brand-subtle text-brand before:opacity-100",
              )}
            >
              <Icon
                className={cn(
                  "size-4 shrink-0 transition-colors duration-150",
                  active && "text-brand",
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "truncate transition-opacity duration-200",
                  collapsible && "sidebar-collapsed:opacity-0",
                )}
              >
                {title}
              </span>
            </Link>
          </Tooltip>
        </li>
      );
    });

  return (
    <nav aria-label="Primary" className="flex h-full flex-col gap-4">
      <ul className="flex flex-col gap-0.5">{renderItems(workspaceItems)}</ul>
      <ul className="mt-auto flex flex-col gap-0.5">{renderItems(systemItems)}</ul>
    </nav>
  );
}
