import { Hand, History, House, type LucideIcon, Settings2, Workflow } from "lucide-react";
import Link from "next/link";

import { AGENT_TABS, type AgentTab, automationHref } from "@/lib/agent";
import { cn } from "@/utils/common";

const TAB_ICONS: Record<AgentTab, LucideIcon> = {
  overview: House,
  workflows: Workflow,
  approvals: Hand,
  activity: History,
  settings: Settings2,
};

/**
 * The Automation sections. A sticky side rail when the page is wide; below that, a row of chips
 * that scrolls sideways.
 */
export function AutomationNav({ tab, pending }: { tab: AgentTab; pending: number }) {
  return (
    <nav aria-label="Automation sections" className="min-w-0">
      <ul className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto px-1 @5xl/automation:mx-0 @5xl/automation:flex-col @5xl/automation:overflow-visible @5xl/automation:px-0">
        {AGENT_TABS.map((option) => {
          const Icon = TAB_ICONS[option.value];
          const selected = tab === option.value;
          return (
            <li
              key={option.value}
              // Settings sits apart from the views of the agent's work.
              className={cn(
                option.value === "settings" &&
                  "@5xl/automation:mt-3 @5xl/automation:border-t @5xl/automation:pt-3",
              )}
            >
              <Link
                href={automationHref(option.value)}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring @5xl/automation:w-full @5xl/automation:rounded-lg @5xl/automation:border-transparent",
                  selected
                    ? "border-transparent bg-brand-subtle text-brand"
                    : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground @5xl/automation:bg-transparent",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="flex-1 text-left">{option.label}</span>
                {option.value === "approvals" && pending > 0 ? (
                  <span className="min-w-6 rounded-full bg-warning px-1.5 text-center text-xs text-white tabular-nums">
                    {pending}
                    <span className="sr-only"> waiting</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
