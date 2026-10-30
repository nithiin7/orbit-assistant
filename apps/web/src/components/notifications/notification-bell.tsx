"use client";

import type { Notification } from "@orbit/contracts";
import { Bell, BellRing, CheckCheck } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, useCallback, useEffect, useId, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useNotificationList,
  useNotificationMutations,
  useUnreadCount,
} from "@/hooks/use-notifications";
import { formatReceived } from "@/lib/reminders";
import { useWorkspaces } from "@/providers/workspace";
import { cn } from "@/utils/common";

const PANEL_WIDTH = 352;

type NotificationBellProps = {
  /** Where the panel opens: beside the desktop sidebar, or below the mobile top bar. */
  placement?: "sidebar" | "header";
};

function unreadLabel(unread: number | null): string {
  if (!unread) return "Notifications";
  return `Notifications, ${unread} unread`;
}

/**
 * A bell with the unread count, opening a panel of recent notifications. The panel is a
 * non-modal disclosure: Escape or a click outside closes it and returns focus to the bell.
 */
export function NotificationBell({ placement = "sidebar" }: NotificationBellProps) {
  const unread = useUnreadCount();
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const open = position !== null;

  const close = useCallback((restoreFocus = true) => {
    setPosition(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
    setPosition(
      placement === "sidebar"
        ? {
            bottom: window.innerHeight - rect.bottom,
            left: Math.min(rect.right + 8, window.innerWidth - width - 8),
            width,
          }
        : { top: rect.bottom + 8, right: 8, width },
    );
  };

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
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

  const Icon = unread ? BellRing : Bell;

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        aria-label={unreadLabel(unread)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(false) : openPanel())}
        className="relative"
      >
        <Icon aria-hidden="true" />
        {unread ? (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[0.625rem] leading-none font-semibold text-brand-foreground tabular-nums"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </Button>
      {/* Announced politely when new notifications arrive while the panel is closed. */}
      <span role="status" className="sr-only">
        {unread ? `${unread} unread ${unread === 1 ? "notification" : "notifications"}` : ""}
      </span>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="region"
          aria-label="Notifications"
          tabIndex={-1}
          style={position}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
          className="fixed z-50 flex max-h-[min(32rem,80vh)] animate-tooltip-in flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-elevation-3 outline-none motion-reduce:animate-none"
        >
          <NotificationPanel onNavigate={() => close(false)} />
        </div>
      ) : null}
    </>
  );
}

function NotificationPanel({ onNavigate }: { onNavigate: () => void }) {
  const { state, reload } = useNotificationList(true);
  const { setRead, readAll } = useNotificationMutations();
  const [error, setError] = useState<string | null>(null);
  const unread = state.status === "success" ? state.data.unread : 0;

  const toggleRead = (notification: Notification) => {
    setError(null);
    setRead
      .mutateAsync({ notification, read: notification.read_at === null })
      .catch((reason: unknown) =>
        setError(describeApiError(reason, "Couldn’t update the notification.")),
      );
  };

  const markAll = () => {
    setError(null);
    readAll
      .mutateAsync()
      .catch((reason: unknown) =>
        setError(describeApiError(reason, "Couldn’t mark notifications read.")),
      );
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={unread === 0 || readAll.isPending}
          onClick={markAll}
        >
          <CheckCheck aria-hidden="true" />
          Mark all read
        </Button>
      </div>
      {error ? (
        <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.status === "loading" ? (
          <div className="space-y-3 p-4" aria-busy="true">
            <span className="sr-only">Loading notifications…</span>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : state.status === "error" ? (
          <div role="alert" className="space-y-3 p-4 text-sm">
            <p>{state.message}</p>
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : state.data.notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Bell className="size-5 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">You’re all caught up</p>
            <p className="text-xs text-muted-foreground">Reminders appear here when they’re due.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {state.data.notifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onToggleRead={toggleRead}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t px-4 py-2.5">
        <Link
          href="/reminders"
          onClick={onNavigate}
          className="rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Manage reminders
        </Link>
      </div>
    </>
  );
}

function NotificationRow({
  notification,
  onToggleRead,
}: {
  notification: Notification;
  onToggleRead: (notification: Notification) => void;
}) {
  const { state } = useWorkspaces();
  const isUnread = notification.read_at === null;
  // Notifications come from every workspace; name the workspace when it isn't the active one.
  const workspace =
    state.status === "ready" && state.active.id !== notification.workspace_id
      ? state.workspaces.find((item) => item.id === notification.workspace_id)?.name
      : undefined;

  return (
    <li className={cn("flex items-start gap-3 px-4 py-3", isUnread && "bg-brand-subtle/40")}>
      <span
        aria-hidden="true"
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          isUnread ? "bg-brand" : "bg-transparent",
        )}
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className={cn("text-sm break-words", isUnread && "font-medium")}>
          {isUnread ? <span className="sr-only">Unread: </span> : null}
          {notification.title}
        </p>
        {notification.body ? (
          <p className="line-clamp-2 text-xs break-words whitespace-pre-line text-muted-foreground">
            {notification.body}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          <time dateTime={notification.created_at}>{formatReceived(notification.created_at)}</time>
          {workspace ? ` · ${workspace}` : null}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2 text-xs"
        aria-label={`Mark “${notification.title}” as ${isUnread ? "read" : "unread"}`}
        onClick={() => onToggleRead(notification)}
      >
        {isUnread ? "Mark read" : "Mark unread"}
      </Button>
    </li>
  );
}
