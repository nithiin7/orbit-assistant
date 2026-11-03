"use client";

import type { AgentModule, AgentTrigger } from "@orbit/contracts";
import { Clock, Gauge, type LucideIcon, Play, Zap } from "lucide-react";
import { useState } from "react";

import {
  describeTrigger,
  missingModules,
  MODULE_LABELS,
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
  WORKFLOW_TEMPLATES,
  type WorkflowTemplate,
} from "@/lib/agent";
import { cn } from "@/utils/common";

import { SectionHeading } from "./shared";

const TRIGGER_ICONS: Record<AgentTrigger["kind"], LucideIcon> = {
  manual: Play,
  schedule: Clock,
  event: Zap,
  condition: Gauge,
};

const FILTERS: readonly { id: TemplateCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  ...TEMPLATE_CATEGORIES,
];

/** Ready-made workflows. Choosing one opens it in the editor; nothing is saved until then. */
export function TemplateGallery({
  allowed,
  timeZone,
  onUse,
}: {
  allowed: readonly AgentModule[];
  timeZone: string;
  onUse: (template: WorkflowTemplate) => void;
}) {
  const [filter, setFilter] = useState<TemplateCategory | "all">("all");
  const shown = WORKFLOW_TEMPLATES.filter(
    (template) => filter === "all" || template.category === filter,
  );

  return (
    <section className="space-y-4">
      <SectionHeading title="Templates" />
      <div
        role="group"
        aria-label="Template categories"
        className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto px-1"
      >
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
            className={cn(
              "h-8 shrink-0 rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === option.id
                ? "bg-brand-subtle text-brand"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <ul className="grid gap-3 @3xl:grid-cols-2 @6xl:grid-cols-3">
        {shown.map((template) => (
          <li key={template.id}>
            <TemplateCard
              template={template}
              missing={missingModules(template, allowed)}
              timeZone={timeZone}
              onUse={() => onUse(template)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TemplateCard({
  template,
  missing,
  timeZone,
  onUse,
}: {
  template: WorkflowTemplate;
  missing: readonly AgentModule[];
  timeZone: string;
  onUse: () => void;
}) {
  const trigger = template.workflow(timeZone).trigger;
  const TriggerIcon = TRIGGER_ICONS[trigger.kind];
  return (
    <button
      type="button"
      onClick={onUse}
      className="flex h-full w-full flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors duration-150 outline-none hover:border-brand/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="font-medium">{template.title}</span>
      <span className="text-sm text-muted-foreground">{template.description}</span>
      <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-brand">
          <TriggerIcon className="size-3.5" aria-hidden="true" />
          {describeTrigger(trigger)}
        </span>
        {missing.length > 0 ? (
          <span className="text-muted-foreground">
            Needs {missing.map((module) => MODULE_LABELS[module]).join(", ")}
          </span>
        ) : null}
      </span>
    </button>
  );
}
