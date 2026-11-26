"use client";

import { type QueryKey, useQueryClient } from "@tanstack/react-query";

import { describeApiError } from "@/api/client";
import { useToast } from "@/providers/toast";

export type UndoableDelete = {
  /** What the toast says, such as `Deleted “Milk”.` */
  message: string;
  /** Every cache `hide` touches. It's snapshotted first and put back on Undo or failure. */
  queryKey: QueryKey;
  /** Take the record out of the cache now, so it disappears at once. */
  hide: () => void;
  /** Send the delete. Runs only once the Undo window has passed. */
  commit: () => Promise<unknown>;
  /** The error toast when the delete fails; the record comes back. */
  failure: string;
};

/**
 * Delete with Undo instead of asking first. The record leaves the screen at once, a toast offers
 * Undo, and the request is sent only when the toast goes (it times out, is closed or replaced, or
 * the page is left), so Undo needs nothing from the server. A failed delete brings the record
 * back and says so.
 */
export function useUndoableDelete() {
  const queryClient = useQueryClient();
  const { show } = useToast();

  return async ({ message, queryKey, hide, commit, failure }: UndoableDelete) => {
    // A refetch landing now would bring the record straight back.
    await queryClient.cancelQueries({ queryKey });
    const snapshot = queryClient.getQueriesData({ queryKey });
    const restore = () => {
      for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
      // Pick up anything else that changed meanwhile.
      void queryClient.invalidateQueries({ queryKey });
    };
    hide();
    show({
      message,
      action: { label: "Undo", onAction: restore },
      onExpire: () => {
        commit().catch((reason: unknown) => {
          restore();
          show({ message: describeApiError(reason, failure), tone: "error" });
        });
      },
    });
  };
}
