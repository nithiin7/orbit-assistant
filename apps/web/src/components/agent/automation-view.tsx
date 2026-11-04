"use client";

import { useSearchParams } from "next/navigation";

import { useAgentOverview } from "@/hooks/use-agent";
import { parseAgentTab } from "@/lib/agent";

import { ActivityView } from "./activity";
import { AgentSettings } from "./agent-settings";
import { ApprovalCenter } from "./approvals";
import { AutomationNav } from "./automation-nav";
import { OverviewView } from "./overview";
import { ErrorNote, LoadingRows } from "./shared";
import { WorkflowsView } from "./workflows";

/** The Automation area: the tab (and an open run or template) live in the URL. */
export function AutomationView() {
  const params = useSearchParams();
  const tab = parseAgentTab(params.get("tab"));
  const overview = useAgentOverview();
  const pending = overview.status === "success" ? overview.data.pending_approvals : 0;

  return (
    // Layout follows the space the page gets (which depends on the app sidebar), not the screen.
    <div className="@container/automation">
      <div className="grid gap-6 @5xl/automation:grid-cols-[13rem_minmax(0,1fr)] @5xl/automation:gap-8 @7xl/automation:grid-cols-[15rem_minmax(0,1fr)] @7xl/automation:gap-12">
        <aside className="min-w-0 @5xl/automation:sticky @5xl/automation:top-6 @5xl/automation:self-start">
          <AutomationNav tab={tab} pending={pending} />
        </aside>

        <div key={tab} className="@container min-w-0 animate-page-in space-y-6">
          {overview.status === "loading" ? (
            <LoadingRows label="Loading the agent" />
          ) : overview.status === "error" ? (
            <ErrorNote message={overview.message} />
          ) : tab === "overview" ? (
            <OverviewView overview={overview.data} />
          ) : tab === "workflows" ? (
            <WorkflowsView agent={overview.data.agent} templateId={params.get("template")} />
          ) : tab === "approvals" ? (
            <ApprovalCenter />
          ) : tab === "activity" ? (
            <ActivityView runId={params.get("run")} filter={params.get("status") ?? "all"} />
          ) : (
            <AgentSettings agent={overview.data.agent} runtime={overview.data.runtime} />
          )}
        </div>
      </div>
    </div>
  );
}
