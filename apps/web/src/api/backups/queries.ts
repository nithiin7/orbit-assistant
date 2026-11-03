import type { BackupOverview } from "@orbit/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { getBackupOverview } from "./requests";

export const backupKeys = {
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "backups"] as const,
};

/** True while a backup is running, so the view polls until it's done. */
export function isBackupRunning(overview: BackupOverview | undefined): boolean {
  return overview?.running ?? false;
}

export function backupOverviewOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: backupKeys.all(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => getBackupOverview(token, workspaceId, { signal })),
    // An automatic backup started by the worker finishes in the background.
    refetchInterval: (query) => (isBackupRunning(query.state.data) ? 3_000 : false),
  });
}
