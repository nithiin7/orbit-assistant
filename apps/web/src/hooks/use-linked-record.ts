"use client";

import { useEffect, useEffectEvent } from "react";

import { useAuth } from "@/providers/auth";

/**
 * The record named by the page's `?<param>=` (a link from search or another module), fetched
 * once so the page can open it in its own dialog. The parameter is removed from the address
 * afterwards, so a reload doesn't reopen it. A record that no longer exists, or that the person
 * can't reach, simply opens nothing.
 */
export function useLinkedRecord<T>(
  param: string,
  workspaceId: string,
  load: (token: string, workspaceId: string, id: string, signal: AbortSignal) => Promise<T>,
  onFound: (record: T) => void,
) {
  const { withToken } = useAuth();
  const found = useEffectEvent(onFound);
  const fetchRecord = useEffectEvent((id: string, signal: AbortSignal): Promise<T> =>
    withToken((token) => load(token, workspaceId, id, signal)),
  );
  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get(param);
    if (!id) return;
    // The parameter is removed only once the request settles, so an effect that runs twice
    // (development's Strict Mode) still opens the record.
    const clear = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete(param);
      window.history.replaceState(window.history.state, "", url);
    };
    const controller = new AbortController();
    fetchRecord(id, controller.signal).then(
      (record) => {
        clear();
        found(record);
      },
      () => {
        if (!controller.signal.aborted) clear();
      },
    );
    return () => controller.abort();
  }, [param, workspaceId]);
}
