"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { isActivePath, type NavItem, sidebarSections } from "@/lib/navigation";
import { cn } from "@/utils/common";

import { useSidebarCollapsed } from "./sidebar-state";

type NavLinksProps = {
  onNavigate?: () => void;
  /** In the desktop sidebar: labels fade out and tooltips take over when it is collapsed. */
  collapsible?: boolean;
};

export function NavLinks({ onNavigate, collapsible = false }: NavLinksProps) {
  const pathname = usePathname();
  const collapsed = useSidebarCollapsed() && collapsible;
  // The sidebar and the mobile drawer can both be mounted, so heading ids must be unique.
  const headingId = useId();

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
    <nav aria-label="Primary" className="flex flex-col gap-4">
      {sidebarSections.map(({ id, label, items }) => (
        <div key={id} className="space-y-0.5">
          {label ? (
            // Collapsed, the heading gives way to a divider so the icons still read as groups.
            <p
              id={`${headingId}-${id}`}
              className="relative flex h-6 items-center px-3 text-xs font-medium tracking-wide text-muted-foreground/80 uppercase"
            >
              <span
                className={cn(
                  "truncate transition-opacity duration-200",
                  collapsible && "sidebar-collapsed:opacity-0",
                )}
              >
                {label}
              </span>
              {collapsible ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 top-1/2 h-px bg-sidebar-border opacity-0 transition-opacity duration-200 sidebar-collapsed:opacity-100"
                />
              ) : null}
            </p>
          ) : null}
          <ul
            aria-labelledby={label ? `${headingId}-${id}` : undefined}
            className="flex flex-col gap-0.5"
          >
            {renderItems(items)}
          </ul>
        </div>
      ))}
    </nav>
  );
}
