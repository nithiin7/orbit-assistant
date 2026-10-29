"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect } from "react";

import { useIsMac } from "@/components/shortcut-hint";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  isEditableTarget,
  isMacPlatform,
  matchesModShortcut,
  modKeyLabel,
  modKeyShortcut,
} from "@/lib/keyboard";
import { readSidebarCollapsed } from "@/lib/sidebar-preference";

import { setSidebarCollapsed, useSidebarCollapsed } from "./sidebar-state";

/** Matches the `md` breakpoint at which the desktop sidebar is shown. */
const DESKTOP_QUERY = "(min-width: 48rem)";
const SHORTCUT_KEY = "b";

/** Collapses or expands the desktop sidebar; also bound to Cmd+B on macOS and Ctrl+B elsewhere. */
export function SidebarToggle() {
  const collapsed = useSidebarCollapsed();
  const isMac = useIsMac();
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  useEffect(() => {
    const mac = isMacPlatform(navigator.userAgent);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesModShortcut(event, SHORTCUT_KEY, mac)) return;
      // Leave text fields (e.g. bold in a future editor) and the hidden mobile sidebar alone.
      if (isEditableTarget(event.target) || !window.matchMedia(DESKTOP_QUERY).matches) return;
      event.preventDefault();
      setSidebarCollapsed(!readSidebarCollapsed());
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Tooltip label={label} shortcut={isMac === null ? undefined : modKeyLabel(SHORTCUT_KEY, isMac)}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-controls="sidebar"
        aria-keyshortcuts={modKeyShortcut(SHORTCUT_KEY, isMac)}
        onClick={() => setSidebarCollapsed(!collapsed)}
        className="text-muted-foreground hover:text-foreground"
      >
        <Icon aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}
