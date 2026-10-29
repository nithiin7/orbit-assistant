"use client";

import { Check, ChevronsUpDown, LogOut, RotateCw } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { workspaceInitial } from "@/lib/workspaces";
import { useAuth, useCurrentUser } from "@/providers/auth-provider";
import { useWorkspaces } from "@/providers/workspace-provider";

const itemClassName =
  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring";

type WorkspaceSwitcherProps = {
  /** In the desktop sidebar: collapses to the workspace initial when the sidebar does. */
  collapsible?: boolean;
  /** Called after an item is chosen, e.g. to close the mobile drawer. */
  onNavigate?: () => void;
};

/**
 * Shows the active workspace and opens a menu to switch workspaces or sign out. It sits at the
 * foot of the sidebar, so the menu opens upward. Follows the ARIA menu pattern: arrow keys,
 * Home/End, and Escape. The menu uses fixed positioning so the collapsed sidebar's overflow
 * can't clip it.
 */
export function WorkspaceSwitcher({ collapsible = false, onNavigate }: WorkspaceSwitcherProps) {
  const { state, switchWorkspace, refresh } = useWorkspaces();
  const { signOut } = useAuth();
  const user = useCurrentUser();
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = position !== null;

  const close = useCallback((restoreFocus = true) => {
    setPosition(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      bottom: window.innerHeight - rect.top + 4,
      left: rect.left,
      minWidth: Math.max(rect.width, 232),
    });
  };

  useEffect(() => {
    if (!open) return;
    const items = menuItems(menuRef.current);
    (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        close(false);
      }
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  if (state.status === "loading") {
    return (
      <div className="flex h-12 items-center gap-3 px-1.5" aria-busy="true">
        <span className="sr-only">Loading workspaces…</span>
        <Skeleton className="size-6 shrink-0" />
        <Skeleton className={cn("h-4 flex-1", collapsible && "sidebar-collapsed:opacity-0")} />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <>
        <Tooltip label="Retry loading workspaces" disabled={!collapsible}>
          <button
            type="button"
            onClick={refresh}
            aria-describedby={`${menuId}-error`}
            title={state.message}
            className="flex h-10 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-sm text-warning outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCw className="size-4 shrink-0" aria-hidden="true" />
            <span className={cn("truncate", collapsible && "sidebar-collapsed:opacity-0")}>
              Retry loading workspaces
            </span>
          </button>
        </Tooltip>
        <span id={`${menuId}-error`} className="sr-only">
          {state.message}
        </span>
      </>
    );
  }

  const { workspaces, active } = state;

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => items.at(next % items.length)?.focus();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(-1);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  const choose = (workspaceId: string) => {
    switchWorkspace(workspaceId);
    close();
    onNavigate?.();
  };

  return (
    <>
      <Tooltip label={`Workspace: ${active.name}`} disabled={!collapsible}>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`Workspace: ${active.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => (open ? close(false) : openMenu())}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              openMenu();
            }
          }}
          className="flex h-12 w-full items-center gap-3 overflow-hidden rounded-lg px-1.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-sidebar-accent"
        >
          <WorkspaceAvatar name={active.name} />
          <span
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-0.5 transition-opacity duration-200",
              collapsible && "sidebar-collapsed:opacity-0",
            )}
          >
            <span className="truncate text-sm leading-tight font-medium">{active.name}</span>
            <span className="truncate text-xs leading-tight text-muted-foreground">
              {user.display_name}
            </span>
          </span>
          <ChevronsUpDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground",
              collapsible && "sidebar-collapsed:opacity-0",
            )}
            aria-hidden="true"
          />
        </button>
      </Tooltip>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Workspaces"
          onKeyDown={onMenuKeyDown}
          style={{ position: "fixed", ...position }}
          className="z-50 max-w-72 animate-tooltip-in rounded-lg border bg-popover p-1 text-popover-foreground shadow-elevation-3"
        >
          <p className="truncate px-2 pt-1.5 pb-1 text-xs text-muted-foreground" title={user.email}>
            {user.email}
          </p>
          <div role="group" aria-label="Switch workspace">
            {workspaces.map((workspace) => {
              const current = workspace.id === active.id;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  tabIndex={-1}
                  onClick={() => choose(workspace.id)}
                  className={itemClassName}
                >
                  <WorkspaceAvatar name={workspace.name} small />
                  <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                  <Check
                    className={cn("size-4 text-brand", current ? "opacity-100" : "opacity-0")}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
          <div role="separator" className="-mx-1 my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              close(false);
              void signOut();
            }}
            className={itemClassName}
          >
            <LogOut className="size-4 text-muted-foreground" aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </>
  );
}

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? []);
}

export function WorkspaceAvatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-brand-subtle font-semibold text-brand",
        small ? "size-5 text-[0.625rem]" : "size-7 text-xs shadow-elevation-1",
      )}
    >
      {workspaceInitial(name)}
    </span>
  );
}
