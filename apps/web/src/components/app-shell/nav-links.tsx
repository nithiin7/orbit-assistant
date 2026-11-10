"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import {
  canHideNavItem,
  isActivePath,
  type NavItem,
  navItemKey,
  sidebarSections,
} from "@/lib/navigation";
import { cn } from "@/utils/common";

import { setNavGroupFolded, useNavPreference, useSidebarCollapsed } from "./sidebar-state";

type NavLinksProps = {
  onNavigate?: () => void;
  /** In the desktop sidebar: labels fade out and tooltips take over when it is collapsed. */
  collapsible?: boolean;
};

export function NavLinks({ onNavigate, collapsible = false }: NavLinksProps) {
  const pathname = usePathname();
  const collapsed = useSidebarCollapsed() && collapsible;
  const { hidden, folded } = useNavPreference();
  // The sidebar and the mobile drawer can both be mounted, so ids must be unique.
  const baseId = useId();

  const renderItem = ({ title, href, icon: Icon }: NavItem) => {
    const active = isActivePath(pathname, href);
    return (
      <li key={href} data-nav-item={navItemKey({ href })}>
        <Tooltip label={title} disabled={!collapsed}>
          <Link
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-3 overflow-hidden rounded-lg px-3 text-sm text-muted-foreground transition-[color,background-color,box-shadow] duration-150 outline-none",
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring",
              active &&
                "bg-card font-medium text-foreground shadow-elevation-1 ring-1 ring-sidebar-border hover:bg-card hover:text-foreground dark:bg-sidebar-accent dark:shadow-none dark:ring-0",
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
  };

  return (
    <nav aria-label="Primary" className="flex flex-col gap-4">
      {sidebarSections.map(({ id, label, items }) => {
        const shown = items.filter(
          (item) => !canHideNavItem(item) || !hidden.includes(navItemKey(item)),
        );
        if (shown.length === 0) return null;

        const isFolded = label !== null && folded.includes(id) && !collapsed;
        // A folded section still shows the page you're on, so you never lose your place.
        const visible = isFolded
          ? shown.filter((item) => isActivePath(pathname, item.href))
          : shown;
        const headingId = `${baseId}-${id}`;
        const listId = `${baseId}-${id}-list`;

        return (
          <div key={id} data-nav-group={id} className="space-y-0.5">
            {label ? (
              <div className="relative">
                <button
                  type="button"
                  aria-expanded={!isFolded}
                  aria-controls={listId}
                  onClick={() => setNavGroupFolded(id, !isFolded)}
                  className={cn(
                    "group/heading flex h-6 w-full items-center gap-1 rounded-md px-3 text-xs font-medium text-muted-foreground/80 transition-[color,opacity] duration-200 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    // Collapsed, the heading gives way to a divider and leaves the tab order.
                    collapsible && "sidebar-collapsed:invisible sidebar-collapsed:opacity-0",
                  )}
                >
                  <span id={headingId} className="truncate">
                    {label}
                  </span>
                  <ChevronRight
                    className={cn(
                      "size-3 shrink-0 transition-[transform,opacity] duration-150 motion-reduce:transition-none",
                      isFolded
                        ? "opacity-100"
                        : "rotate-90 opacity-0 group-hover/heading:opacity-100 group-focus-visible/heading:opacity-100",
                    )}
                    aria-hidden="true"
                  />
                </button>
                {collapsible ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-3 top-1/2 h-px bg-sidebar-border opacity-0 transition-opacity duration-200 sidebar-collapsed:opacity-100"
                  />
                ) : null}
              </div>
            ) : null}
            <ul
              id={listId}
              aria-labelledby={label ? headingId : undefined}
              className="flex flex-col gap-0.5"
            >
              {visible.map(renderItem)}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
