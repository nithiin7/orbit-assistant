"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { deleteMyDashboard, getMyDashboard, putMyDashboard } from "@/api/dashboard";
import { useAuth } from "@/components/auth/auth-provider";
import {
  clearDashboardLayout,
  type DashboardWidget,
  defaultLayout,
  hasStoredDashboardLayout,
  readDashboardLayout,
  writeDashboardLayout,
} from "@/lib/dashboard";

type Change = { kind: "save"; widgets: DashboardWidget[] } | { kind: "reset" };

type DashboardLayoutState = {
  layout: DashboardWidget[];
  /** Show `next` at once, then save it to the user's account. */
  update: (next: DashboardWidget[]) => void;
  /** Go back to the default layout, here and in the user's account. */
  reset: () => void;
  /** Set when the last save failed; the layout still applies in this browser. */
  saveError: string | null;
  /** Save the current layout again after a failure. */
  retry: () => void;
};

/**
 * The signed-in user's dashboard layout. The account (API) is the source of truth; this
 * browser's copy shows the layout instantly while the API answers. A layout saved in this
 * browser before the account had one is uploaded once, so existing arrangements carry over.
 */
export function useDashboardLayout(userId: string): DashboardLayoutState {
  const { withToken } = useAuth();
  const [layout, setLayout] = useState(() => readDashboardLayout(userId));
  const [saveError, setSaveError] = useState<string | null>(null);
  const layoutRef = useRef(layout);
  // Set once the user changes the layout, so a slow first load can't overwrite their change.
  const changed = useRef(false);
  // Changes are sent one at a time, newest last, so responses can't land out of order.
  const queued = useRef<Change | null>(null);
  const sending = useRef(false);

  const send = useCallback(
    async (change: Change) => {
      queued.current = change;
      if (sending.current) return;
      sending.current = true;
      try {
        while (queued.current) {
          const next: Change = queued.current;
          queued.current = null;
          await withToken(async (token) => {
            if (next.kind === "reset") await deleteMyDashboard(token);
            else await putMyDashboard(token, { widgets: next.widgets });
          });
        }
        setSaveError(null);
      } catch (reason) {
        // The whole layout is sent each time, so the next change or a retry catches up.
        queued.current = null;
        setSaveError(
          describeApiError(
            reason,
            "Couldn’t save your layout to your account. It still applies in this browser.",
          ),
        );
      } finally {
        sending.current = false;
      }
    },
    [withToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    withToken((token) => getMyDashboard(token, { signal: controller.signal })).then(
      (saved) => {
        if (controller.signal.aborted || changed.current) return;
        if (saved) {
          const widgets = saved.widgets.map(({ id, size }) => ({ id, size }));
          layoutRef.current = widgets;
          setLayout(widgets);
          writeDashboardLayout(userId, widgets);
        } else if (hasStoredDashboardLayout(userId)) {
          void send({ kind: "save", widgets: layoutRef.current });
        }
      },
      () => {
        // The browser's copy (or the default) keeps working; the next change tries again.
      },
    );
    return () => controller.abort();
  }, [withToken, userId, send]);

  const update = useCallback(
    (next: DashboardWidget[]) => {
      changed.current = true;
      layoutRef.current = next;
      setLayout(next);
      writeDashboardLayout(userId, next);
      void send({ kind: "save", widgets: next });
    },
    [userId, send],
  );

  const reset = useCallback(() => {
    changed.current = true;
    const next = [...defaultLayout];
    layoutRef.current = next;
    setLayout(next);
    clearDashboardLayout(userId);
    void send({ kind: "reset" });
  }, [userId, send]);

  const retry = useCallback(() => {
    void send(
      hasStoredDashboardLayout(userId)
        ? { kind: "save", widgets: layoutRef.current }
        : { kind: "reset" },
    );
  }, [userId, send]);

  return { layout, update, reset, saveError, retry };
}
