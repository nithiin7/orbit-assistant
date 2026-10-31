"use client";

import { Search } from "lucide-react";

import { useCommandPalette } from "@/components/command-palette/command-palette";
import { ShortcutHint, useIsMac } from "@/components/shortcut-hint";
import { Tooltip } from "@/components/ui/tooltip";
import { modKeyShortcut } from "@/utils/keyboard";

import { useSidebarCollapsed } from "./sidebar-state";

/** Sidebar entry point to the command palette; collapses to an icon with a tooltip. */
export function SidebarSearch() {
  const { open } = useCommandPalette();
  const collapsed = useSidebarCollapsed();
  const isMac = useIsMac();

  return (
    <Tooltip label="Search" disabled={!collapsed}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-keyshortcuts={modKeyShortcut("k", isMac)}
        onClick={open}
        className="flex h-9 w-full items-center gap-3 overflow-hidden rounded-md border bg-card px-[11px] text-sm text-muted-foreground shadow-elevation-1 transition-[color,background-color,border-color,box-shadow] duration-150 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring dark:bg-transparent sidebar-collapsed:border-transparent sidebar-collapsed:bg-transparent sidebar-collapsed:shadow-none"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate text-left transition-opacity duration-200 sidebar-collapsed:opacity-0">
          Search
        </span>
        <ShortcutHint
          keyName="k"
          className="transition-opacity duration-200 sidebar-collapsed:opacity-0"
        />
      </button>
    </Tooltip>
  );
}
