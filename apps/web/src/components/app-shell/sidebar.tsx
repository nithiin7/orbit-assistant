import { Logo } from "@/components/logo";
import { QuickCaptureButton } from "@/components/notes/quick-capture";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";

import { NavLinks } from "./nav-links";
import { SidebarSearch } from "./sidebar-search";
import { SidebarToggle } from "./sidebar-toggle";

/**
 * Desktop sidebar. Its width follows `<html data-sidebar>` through the `sidebar-collapsed`
 * variant, so the saved state applies before hydration without a layout jump. Collapsed, the
 * expand button takes the logo's place on hover or keyboard focus.
 */
export function Sidebar() {
  return (
    <aside
      id="sidebar"
      aria-label="Sidebar"
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out-soft md:flex sidebar-collapsed:w-14"
    >
      <div className="group/header relative flex h-14 shrink-0 items-center justify-between gap-2 pr-2 pl-4">
        <Logo
          className="transition-opacity duration-150 sidebar-collapsed:group-hover/header:opacity-0 sidebar-collapsed:group-has-[button:focus-visible]/header:opacity-0"
          textClassName="transition-opacity duration-200 sidebar-collapsed:opacity-0"
        />
        <SidebarToggle className="transition-opacity duration-150 sidebar-collapsed:absolute sidebar-collapsed:top-1/2 sidebar-collapsed:left-2.5 sidebar-collapsed:-translate-y-1/2 sidebar-collapsed:opacity-0 sidebar-collapsed:group-hover/header:opacity-100 sidebar-collapsed:focus-visible:opacity-100" />
      </div>
      <div className="flex items-center gap-1 px-2 pb-2 sidebar-collapsed:flex-col">
        <div className="min-w-0 flex-1 sidebar-collapsed:w-full">
          <SidebarSearch />
        </div>
        <QuickCaptureButton className="text-muted-foreground hover:text-foreground" />
      </div>
      <div className="flex-1 overflow-x-hidden overflow-y-auto px-2 py-2">
        <NavLinks collapsible />
      </div>
      <div className="flex shrink-0 items-center gap-1 p-2 sidebar-collapsed:flex-col-reverse">
        <div className="min-w-0 flex-1 sidebar-collapsed:w-full">
          <WorkspaceSwitcher collapsible />
        </div>
        <NotificationBell />
      </div>
    </aside>
  );
}
