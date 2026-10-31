import { Logo } from "@/components/logo";
import { QuickCaptureButton } from "@/components/notes/quick-capture";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Tooltip } from "@/components/ui/tooltip";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";

import { NavLinks } from "./nav-links";
import { SidebarSearch } from "./sidebar-search";
import { SidebarToggle } from "./sidebar-toggle";

/**
 * Desktop sidebar. Its width follows `<html data-sidebar>` through the `sidebar-collapsed`
 * variant, so the saved state applies before hydration without a layout jump.
 */
export function Sidebar() {
  return (
    <aside
      id="sidebar"
      aria-label="Sidebar"
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out-soft md:flex sidebar-collapsed:w-14"
    >
      <div className="flex h-14 shrink-0 items-center px-4">
        <Logo textClassName="transition-opacity duration-200 sidebar-collapsed:opacity-0" />
      </div>
      <div className="px-2 pb-2">
        <SidebarSearch />
      </div>
      <div className="flex-1 overflow-x-hidden overflow-y-auto px-2 py-2">
        <NavLinks collapsible />
      </div>
      <div className="shrink-0 space-y-1 border-t border-sidebar-border p-2">
        <WorkspaceSwitcher collapsible />
        <div className="flex items-center justify-between gap-1 sidebar-collapsed:flex-col">
          <div className="flex items-center gap-1 sidebar-collapsed:flex-col">
            <Tooltip label="Toggle color theme">
              <ThemeToggle />
            </Tooltip>
            <QuickCaptureButton />
            <NotificationBell />
          </div>
          <SidebarToggle />
        </div>
      </div>
    </aside>
  );
}
