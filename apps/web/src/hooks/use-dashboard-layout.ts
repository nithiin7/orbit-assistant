"use client";

import type { DashboardLayout } from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import {
  dashboardKeys,
  type DashboardLayoutChange,
  dashboardLayoutOptions,
  sendDashboardLayout,
} from "@/api/dashboard";
import {
  clearDashboardLayout,
  type DashboardWidget,
  defaultLayout,
  hasStoredDashboardLayout,
  readDashboardLayout,
  writeDashboardLayout,
} from "@/lib/dashboard";
import { useAuth } from "@/providers/auth";

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

const toWidgets = (saved: DashboardLayout) => saved.widgets.map(({ id, size }) => ({ id, size }));

/**
 * The signed-in user's dashboard layout. The account (API) is the source of truth; this
 * browser's copy shows the layout instantly while the API answers. A layout saved in this
 * browser before the account had one is uploaded once, so existing arrangements carry over.
 */
export function useDashboardLayout(userId: string): DashboardLayoutState {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const account = useQuery(dashboardLayoutOptions(withToken));
  const [local, setLocal] = useState(() => readDashboardLayout(userId));
  // Set once the user changes the layout, so a slow first load can't overwrite their change.
  const [changed, setChanged] = useState(false);
  const fromAccount = useMemo(
    () => (account.data ? toWidgets(account.data) : null),
    [account.data],
  );
  const layout = !changed && fromAccount ? fromAccount : local;

  // Changes share a mutation scope, so they're sent one at a time in order. The whole layout is
  // sent each time, so a change that a newer one has overtaken is skipped rather than sent.
  const latest = useRef(0);
  const save = useMutation({
    scope: { id: "dashboard-layout" },
    mutationFn: ({ change, version }: { change: DashboardLayoutChange; version: number }) =>
      version === latest.current
        ? sendDashboardLayout(withToken, change)
        : Promise.resolve(undefined),
    onSuccess: (saved) => {
      if (saved !== undefined) queryClient.setQueryData(dashboardKeys.layout(), saved);
    },
  });
  const { mutate } = save;
  const send = useCallback(
    (change: DashboardLayoutChange) => {
      latest.current += 1;
      mutate({ change, version: latest.current });
    },
    [mutate],
  );

  // Keep this browser's copy in step with the account.
  useEffect(() => {
    if (!changed && fromAccount) writeDashboardLayout(userId, fromAccount);
  }, [changed, fromAccount, userId]);

  // The account has no layout yet: upload the one arranged in this browser, once.
  const uploaded = useRef(false);
  useEffect(() => {
    if (account.data !== null || changed || uploaded.current) return;
    if (!hasStoredDashboardLayout(userId)) return;
    uploaded.current = true;
    send({ kind: "save", widgets: local });
  }, [account.data, changed, userId, local, send]);

  const update = useCallback(
    (next: DashboardWidget[]) => {
      setChanged(true);
      setLocal(next);
      writeDashboardLayout(userId, next);
      send({ kind: "save", widgets: next });
    },
    [userId, send],
  );

  const reset = useCallback(() => {
    setChanged(true);
    setLocal([...defaultLayout]);
    clearDashboardLayout(userId);
    send({ kind: "reset" });
  }, [userId, send]);

  const retry = useCallback(() => {
    send(hasStoredDashboardLayout(userId) ? { kind: "save", widgets: layout } : { kind: "reset" });
  }, [userId, layout, send]);

  const saveError = save.isError
    ? describeApiError(
        save.error,
        "Couldn’t save your layout to your account. It still applies in this browser.",
      )
    : null;

  return { layout, update, reset, saveError, retry };
}
