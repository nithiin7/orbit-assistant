"use client";

import { useQuery } from "@tanstack/react-query";

import { workspaceOptions } from "@/api/workspaces";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { queryResource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth, useCurrentUser } from "@/providers/auth-provider";
import { useWorkspaces } from "@/providers/workspace-provider";

import { WorkspaceAvatar } from "./workspace-switcher";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** The active workspace, as confirmed by the API for the signed-in user. */
export function WorkspaceOverview() {
  const user = useCurrentUser();
  const { withToken } = useAuth();
  const { state } = useWorkspaces();
  const workspaceId = state.status === "ready" ? state.active.id : null;
  const result = useQuery(workspaceOptions(withToken, workspaceId));
  useWorkspaceNotFound(result.error);
  const resource = queryResource(result, "Couldn’t load this workspace.");
  const reload = () => void result.refetch();

  return (
    <section aria-labelledby="workspace-overview-heading" className="h-full">
      <h2 id="workspace-overview-heading" className="sr-only">
        Current workspace
      </h2>
      <Card
        className="flex h-full min-h-20 items-center gap-4 p-5 shadow-elevation-1"
        aria-live="polite"
      >
        {resource.status === "loading" ? (
          <>
            <span className="sr-only">Loading workspace…</span>
            <Skeleton className="size-7" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </>
        ) : resource.status === "error" ? (
          <div role="alert" className="flex w-full flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{resource.message}</p>
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <WorkspaceAvatar name={resource.data.name} />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-base font-semibold">{resource.data.name}</p>
                {resource.data.is_personal ? <Badge variant="outline">Personal</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">
                Signed in as {user.display_name} · Created{" "}
                {dateFormat.format(new Date(resource.data.created_at))}
              </p>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
