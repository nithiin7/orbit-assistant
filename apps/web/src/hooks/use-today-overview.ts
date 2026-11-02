"use client";

import type { TodayOverview } from "@orbit/contracts";
import { useQuery } from "@tanstack/react-query";

import { todayOverviewOptions } from "@/api/dashboard";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useActiveWorkspaceId, useViewerTimeZone } from "@/hooks/use-calendar";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";

/**
 * The active workspace's daily overview, in the viewer's time zone. The Today and Needs
 * attention widgets share it, so it is fetched once however many of them are shown.
 */
export function useTodayOverview(): {
  resource: Resource<TodayOverview>;
  reload: () => void;
  refreshing: boolean;
  timeZone: string;
} {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const timeZone = useViewerTimeZone();
  const result = useQuery(todayOverviewOptions(withToken, workspaceId, timeZone));
  useWorkspaceNotFound(result.error);
  return {
    resource: queryResource(result, "Couldn’t load today’s overview."),
    reload: () => void result.refetch(),
    refreshing: result.isFetching && result.data !== undefined,
    timeZone,
  };
}
