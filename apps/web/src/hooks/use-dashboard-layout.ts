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
import { DASHBOARD_LAYOUT_SCOPE } from "@/api/query-client";
import {
  clearDashboardLayout,
  type DashboardPreferences,
  type DashboardWidget,
  defaultLayout,
  defaultPreferences,
  hasStoredDashboardLayout,
  readDashboardLayout,
  readDashboardPreferences,
  writeDashboardLayout,
} from "@/lib/dashboard";
import { useAuth } from "@/providers/auth";

type DashboardLayoutState = {
  layout: DashboardWidget[];
  preferences: DashboardPreferences;
  /** Show `next` at once, then save it to the user's account. */
  update: (next: DashboardWidget[]) => void;
  /** Change how the dashboard is shown, here and in the user's account. */
  setPreferences: (next: DashboardPreferences) => void;
  /** Go back to the default layout and display, here and in the user's account. */
  reset: () => void;
  /** Set when the last save failed; the layout still applies in this browser. */
  saveError: string | null;
  /** Save the current layout again after a failure. */
  retry: () => void;
};

type Arrangement = { widgets: DashboardWidget[]; preferences: DashboardPreferences };

const fromAccount = (saved: DashboardLayout): Arrangement => ({
  widgets: saved.widgets.map(({ id, size }) => ({ id, size })),
  preferences: { density: saved.density, hideAmounts: saved.hide_amounts },
});

const toRequest = ({ widgets, preferences }: Arrangement): DashboardLayoutChange => ({
  kind: "save",
  layout: { widgets, density: preferences.density, hide_amounts: preferences.hideAmounts },
});

/**
 * The signed-in user's dashboard layout and display preferences. The account (API) is the
 * source of truth; this browser's copy shows the layout instantly while the API answers. A
 * layout saved in this browser before the account had one is uploaded once, so existing
 * arrangements carry over.
 */
export function useDashboardLayout(userId: string): DashboardLayoutState {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const account = useQuery(dashboardLayoutOptions(withToken));
  const [local, setLocal] = useState<Arrangement>(() => ({
    widgets: readDashboardLayout(userId),
    preferences: readDashboardPreferences(userId),
  }));
  // Set once the user changes the layout, so a slow first load can't overwrite their change.
  const [changed, setChanged] = useState(false);
  const saved = useMemo(() => (account.data ? fromAccount(account.data) : null), [account.data]);
  const current = !changed && saved ? saved : local;

  // Changes share a mutation scope, so they're sent one at a time in order. The whole layout is
  // sent each time, so a change that a newer one has overtaken is skipped rather than sent.
  const latest = useRef(0);
  const save = useMutation({
    scope: { id: DASHBOARD_LAYOUT_SCOPE },
    mutationFn: ({ change, version }: { change: DashboardLayoutChange; version: number }) =>
      version === latest.current
        ? sendDashboardLayout(withToken, change)
        : Promise.resolve(undefined),
    onSuccess: (result) => {
      if (result !== undefined) queryClient.setQueryData(dashboardKeys.layout(), result);
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
    if (!changed && saved) writeDashboardLayout(userId, saved.widgets, saved.preferences);
  }, [changed, saved, userId]);

  // The account has no layout yet: upload the one arranged in this browser, once.
  const uploaded = useRef(false);
  useEffect(() => {
    if (account.data !== null || changed || uploaded.current) return;
    if (!hasStoredDashboardLayout(userId)) return;
    uploaded.current = true;
    send(toRequest(local));
  }, [account.data, changed, userId, local, send]);

  const apply = useCallback(
    (next: Arrangement) => {
      setChanged(true);
      setLocal(next);
      writeDashboardLayout(userId, next.widgets, next.preferences);
      send(toRequest(next));
    },
    [userId, send],
  );

  const update = useCallback(
    (widgets: DashboardWidget[]) => apply({ widgets, preferences: current.preferences }),
    [apply, current.preferences],
  );

  const setPreferences = useCallback(
    (preferences: DashboardPreferences) => apply({ widgets: current.widgets, preferences }),
    [apply, current.widgets],
  );

  const reset = useCallback(() => {
    setChanged(true);
    setLocal({ widgets: [...defaultLayout], preferences: { ...defaultPreferences } });
    clearDashboardLayout(userId);
    send({ kind: "reset" });
  }, [userId, send]);

  const retry = useCallback(() => {
    send(hasStoredDashboardLayout(userId) ? toRequest(current) : { kind: "reset" });
  }, [userId, current, send]);

  const saveError = save.isError
    ? describeApiError(
        save.error,
        "Couldn’t save your layout to your account. It still applies in this browser.",
      )
    : null;

  return {
    layout: current.widgets,
    preferences: current.preferences,
    update,
    setPreferences,
    reset,
    saveError,
    retry,
  };
}
