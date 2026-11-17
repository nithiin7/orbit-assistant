"use client";

import type { Briefing, BriefingSettings } from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import {
  briefingKeys,
  briefingSettingsOptions,
  narrateBriefing,
  putBriefingSettings,
  regenerateBriefing,
  todayBriefingOptions,
} from "@/api/briefings";
import { describeApiError } from "@/api/client";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useAiReady } from "@/hooks/use-ai";
import { useActiveWorkspaceId, useViewerTimeZone } from "@/hooks/use-calendar";
import { useAuth } from "@/providers/auth";

export type NarratedBriefing = Briefing & { narrative: NonNullable<Briefing["narrative"]> };

/**
 * Where today's AI summary is:
 * - `off`: AI isn't on and set up, so nothing is prepared or written;
 * - `writing`: today's briefing is being prepared, or its summary written;
 * - `ready`: the summary is there;
 * - `failed`: it couldn't be written (`message` says why; the dashboard carries on without it).
 */
export type DailySummary =
  | { status: "off" }
  | { status: "writing" }
  | { status: "ready"; briefing: NarratedBriefing }
  | { status: "failed"; message: string };

/**
 * Today's briefing summary for the dashboard greeting. With AI on, the day's briefing is
 * prepared when first asked for, and its summary written once, automatically; `refresh` reads
 * the day again and rewrites it. With AI off, nothing is asked for at all.
 */
export function useDailySummary(): {
  summary: DailySummary;
  refresh: () => void;
  retry: () => void;
} {
  const { withToken } = useAuth();
  const client = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const timeZone = useViewerTimeZone();
  const ready = useAiReady();
  const todayKey = briefingKeys.today(workspaceId, timeZone);
  const result = useQuery(todayBriefingOptions(withToken, workspaceId, timeZone, ready));

  const narration = useMutation({
    mutationFn: ({ id, briefing }: { id: string; briefing: Briefing }) =>
      withToken((token) => narrateBriefing(token, id, briefing)),
    onSuccess: (briefing) => client.setQueryData(todayKey, briefing),
  });
  const refreshing = useMutation({
    mutationFn: async (id: string) => {
      const fresh = await withToken((token) =>
        regenerateBriefing(token, id, { timezone: timeZone }),
      );
      // The old summary is gone with the old snapshot, even if writing the new one fails.
      client.setQueryData(todayKey, fresh);
      return withToken((token) => narrateBriefing(token, id, fresh));
    },
    onSuccess: (briefing) => client.setQueryData(todayKey, briefing),
  });

  // Each briefing's summary is written once per visit, even if that fails: trying again is the
  // person's choice, so a broken provider isn't asked again on every render.
  const attempted = useRef(new Set<string>());
  const briefing = result.data;
  const pending = narration.isPending || refreshing.isPending;
  const narrate = narration.mutate;
  useEffect(() => {
    if (!ready || workspaceId === null || briefing === undefined || briefing.narrative) return;
    const key = `${briefing.id}:${briefing.revision}`;
    if (attempted.current.has(key) || pending) return;
    attempted.current.add(key);
    narrate({ id: workspaceId, briefing });
  }, [ready, workspaceId, briefing, pending, narrate]);

  const error = refreshing.error ?? narration.error ?? result.error;
  let summary: DailySummary;
  if (!ready) {
    summary = { status: "off" };
  } else if (pending) {
    summary = { status: "writing" };
  } else if (briefing?.narrative) {
    summary = { status: "ready", briefing: { ...briefing, narrative: briefing.narrative } };
  } else if (error) {
    summary = {
      status: "failed",
      message: describeApiError(error, "Couldn’t summarize your day."),
    };
  } else {
    summary = { status: "writing" };
  }

  return {
    summary,
    refresh: () => {
      if (workspaceId === null) return;
      narration.reset();
      refreshing.mutate(workspaceId);
    },
    retry: () => {
      if (workspaceId === null) return;
      if (briefing === undefined) {
        void result.refetch();
        return;
      }
      refreshing.reset();
      narrate({ id: workspaceId, briefing });
    },
  };
}

/** The person's briefing settings in the active workspace, and saving them. */
export function useBriefingSettings(): {
  resource: Resource<BriefingSettings>;
  save: (settings: BriefingSettings) => Promise<BriefingSettings>;
} {
  const { withToken } = useAuth();
  const client = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const result = useQuery(briefingSettingsOptions(withToken, workspaceId));
  const mutation = useMutation({
    mutationFn: ({ id, settings }: { id: string; settings: BriefingSettings }) =>
      withToken((token) => putBriefingSettings(token, id, settings)),
    onSuccess: (saved, { id }) => client.setQueryData(briefingKeys.settings(id), saved),
  });
  return {
    resource: queryResource(result, "Couldn’t load your briefing settings."),
    save: (settings) => {
      if (workspaceId === null) return Promise.reject(new Error("No workspace is open."));
      return mutation.mutateAsync({ id: workspaceId, settings });
    },
  };
}
