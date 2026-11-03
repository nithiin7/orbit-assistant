"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { useAgentOverview } from "@/hooks/use-agent";
import { AGENT_TABS, automationHref, parseAgentTab } from "@/lib/agent";
import { cn } from "@/utils/common";

import { ActivityView } from "./activity";
import { AgentSettings } from "./agent-settings";
import { ApprovalCenter } from "./approvals";
import { OverviewView } from "./overview";
import { ErrorNote, LoadingRows } from "./shared";
import { WorkflowsView } from "./workflows";

/** The Automation area: the tab (and an open run) live in the URL. */
export function AutomationView() {
  const params = useSearchParams();
  const tab = parseAgentTab(params.get("tab"));
  const overview = useAgentOverview();
  const pending = overview.status === "success" ? overview.data.pending_approvals : 0;

  return (
    <div className="@container space-y-6">
      <nav aria-label="Automation sections" className="-mx-1 max-w-full overflow-x-auto px-1">
        <ul className="flex gap-1">
          {AGENT_TABS.map((option) => (
            <li key={option.value}>
              <Link
                href={automationHref(option.value)}
                aria-current={tab === option.value ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  tab === option.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {option.label}
                {option.value === "approvals" && pending > 0 ? (
                  <span className="rounded-full bg-warning px-1.5 text-xs text-white tabular-nums">
                    {pending}
                    <span className="sr-only"> waiting</span>
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {overview.status === "loading" ? (
        <LoadingRows label="Loading the agent" />
      ) : overview.status === "error" ? (
        <ErrorNote message={overview.message} />
      ) : tab === "overview" ? (
        <OverviewView overview={overview.data} />
      ) : tab === "workflows" ? (
        <WorkflowsView enabled={overview.data.agent.enabled} />
      ) : tab === "approvals" ? (
        <ApprovalCenter />
      ) : tab === "activity" ? (
        <ActivityView runId={params.get("run")} filter={params.get("status") ?? "all"} />
      ) : (
        <AgentSettings agent={overview.data.agent} />
      )}
    </div>
  );
}
