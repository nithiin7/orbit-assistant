import type {
  Briefing,
  BriefingQuery,
  BriefingRegenerateRequest,
  BriefingSettings,
} from "@orbit/contracts";

import { request, type Signal, toQueryString, workspacePath } from "../client";

/** Today's briefing in the given time zone; the API prepares it on the day's first request. */
export function getTodayBriefing(
  token: string,
  workspaceId: string,
  query: BriefingQuery = {},
  { signal }: Signal = {},
): Promise<Briefing> {
  return request<Briefing>(
    `${workspacePath(workspaceId, "/briefings/today")}${toQueryString(query)}`,
    { token, signal },
  );
}

/** Prepare today's briefing again from the records as they are now. */
export function regenerateBriefing(
  token: string,
  workspaceId: string,
  body: BriefingRegenerateRequest,
): Promise<Briefing> {
  return request<Briefing>(workspacePath(workspaceId, "/briefings/today/regenerate"), {
    method: "POST",
    body,
    token,
  });
}

/** Ask the person's AI provider to write a summary of one stored briefing. */
export function narrateBriefing(
  token: string,
  workspaceId: string,
  briefing: Pick<Briefing, "date" | "timezone">,
): Promise<Briefing> {
  const query = toQueryString({ timezone: briefing.timezone });
  return request<Briefing>(
    workspacePath(workspaceId, `/briefings/${briefing.date}/narrative${query}`),
    { method: "POST", token },
  );
}

export function getBriefingSettings(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<BriefingSettings> {
  return request<BriefingSettings>(workspacePath(workspaceId, "/briefings/settings"), {
    token,
    signal,
  });
}

export function putBriefingSettings(
  token: string,
  workspaceId: string,
  body: BriefingSettings,
): Promise<BriefingSettings> {
  return request<BriefingSettings>(workspacePath(workspaceId, "/briefings/settings"), {
    method: "PUT",
    body,
    token,
  });
}
