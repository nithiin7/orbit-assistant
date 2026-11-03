"use client";

import type { Agent, AgentStepKind, AgentTool, AgentTrigger } from "@orbit/contracts";
import {
  CalendarDays,
  Clock,
  FileText,
  Gauge,
  GitBranch,
  Hand,
  HeartPulse,
  ListChecks,
  type LucideIcon,
  Play,
  Sparkles,
  Timer,
  Wallet,
  Wrench,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAgentTools, useSaveWorkflow } from "@/hooks/use-agent";
import { useViewerTimeZone } from "@/hooks/use-calendar";
import {
  automationHref,
  describeTrigger,
  findTemplate,
  missingModules,
  MODULE_LABELS,
  STEP_KIND_LABELS,
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
  WORKFLOW_TEMPLATES,
  workflowFormValues,
  workflowRequest,
  type WorkflowTemplate,
} from "@/lib/agent";

import { SectionHeading } from "./shared";
import { WorkflowEditor } from "./workflow-editor";

const CATEGORY_ICONS: Record<TemplateCategory, LucideIcon> = {
  planning: CalendarDays,
  tasks: ListChecks,
  money: Wallet,
  documents: FileText,
  wellbeing: HeartPulse,
};

const TRIGGER_ICONS: Record<AgentTrigger["kind"], LucideIcon> = {
  manual: Play,
  schedule: Clock,
  event: Zap,
  condition: Gauge,
};

const STEP_ICONS: Record<AgentStepKind, LucideIcon> = {
  tool: Wrench,
  ai: Sparkles,
  condition: GitBranch,
  approval: Hand,
  delay: Timer,
};

/**
 * Ready-made workflows that show what the agent can do. Using one opens the workflow editor with
 * it filled in; nothing is saved until the person saves it. `templateId` (from the URL) opens one
 * straight away.
 */
export function TemplatesView({ agent, templateId }: { agent: Agent; templateId: string | null }) {
  const router = useRouter();
  const timeZone = useViewerTimeZone();
  const tools = useAgentTools();
  const save = useSaveWorkflow();
  const [using, setUsing] = useState<WorkflowTemplate | null>(
    () => findTemplate(templateId) ?? null,
  );
  const saved = useRef(false);
  const toolList: readonly AgentTool[] = tools.status === "success" ? tools.data.tools : [];

  return (
    <div className="space-y-8">
      <SectionHeading
        title="Templates"
        description="Ready-made workflows that show what the agent can do. Pick one, change anything you like, and save it as your own."
      />
      {!agent.enabled ? (
        <p className="rounded-lg bg-warning/10 p-3 text-sm">
          The agent is off, so saved workflows won’t run until you turn it on in the Overview.
        </p>
      ) : null}
      {TEMPLATE_CATEGORIES.map((category) => (
        <TemplateSection
          key={category.id}
          category={category.id}
          label={category.label}
          templates={WORKFLOW_TEMPLATES.filter((template) => template.category === category.id)}
          agent={agent}
          timeZone={timeZone}
          onUse={setUsing}
        />
      ))}
      {using ? (
        <WorkflowEditor
          title={using.title}
          initial={workflowFormValues(using.workflow(timeZone), timeZone)}
          tools={toolList}
          onSave={async (values) => {
            await save.mutateAsync({ id: null, body: workflowRequest(values, toolList) });
            saved.current = true;
          }}
          onClose={() => {
            setUsing(null);
            // Once saved, show it among the person's workflows; otherwise drop the template
            // from the URL so a reload doesn't open it again.
            if (saved.current) router.push(automationHref("workflows"));
            else if (templateId) router.replace(automationHref("templates"));
            saved.current = false;
          }}
        />
      ) : null}
    </div>
  );
}

function TemplateSection({
  category,
  label,
  templates,
  agent,
  timeZone,
  onUse,
}: {
  category: TemplateCategory;
  label: string;
  templates: readonly WorkflowTemplate[];
  agent: Agent;
  timeZone: string;
  onUse: (template: WorkflowTemplate) => void;
}) {
  const headingId = useId();
  const Icon = CATEGORY_ICONS[category];
  if (templates.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-brand" aria-hidden="true" />
        {label}
      </h3>
      <ul className="grid gap-3 @3xl:grid-cols-2 @6xl:grid-cols-3">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            agent={agent}
            timeZone={timeZone}
            onUse={() => onUse(template)}
          />
        ))}
      </ul>
    </section>
  );
}

function TemplateCard({
  template,
  agent,
  timeZone,
  onUse,
}: {
  template: WorkflowTemplate;
  agent: Agent;
  timeZone: string;
  onUse: () => void;
}) {
  const titleId = useId();
  const workflow = template.workflow(timeZone);
  const TriggerIcon = TRIGGER_ICONS[workflow.trigger.kind];
  const missing = missingModules(template, agent.modules);
  const kinds = new Set(workflow.steps.map((step) => step.kind));

  return (
    <li
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-elevation-1"
    >
      <div className="space-y-1">
        <h4 id={titleId} className="font-medium">
          {template.title}
        </h4>
        <p className="text-sm text-muted-foreground">{template.description}</p>
      </div>

      <p className="flex items-center gap-2 text-xs font-medium">
        <TriggerIcon className="size-3.5 text-brand" aria-hidden="true" />
        {describeTrigger(workflow.trigger)}
      </p>

      <ol aria-label="Steps" className="space-y-1.5 border-l pl-3">
        {workflow.steps.map((step) => {
          const StepIcon = STEP_ICONS[step.kind];
          return (
            <li key={step.id} className="flex items-center gap-2 text-sm">
              <StepIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 truncate">{step.title || STEP_KIND_LABELS[step.kind]}</span>
            </li>
          );
        })}
      </ol>

      <div className="mt-auto space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {kinds.has("ai") ? <Badge variant="brand">Writes with AI</Badge> : null}
          {kinds.has("condition") ? <Badge>Decides for itself</Badge> : null}
          {kinds.has("approval") ? <Badge>Asks you first</Badge> : null}
          {template.modules.map((module) => (
            <Badge key={module} variant="outline">
              {MODULE_LABELS[module]}
            </Badge>
          ))}
        </div>
        {missing.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Needs access to {missing.map((module) => MODULE_LABELS[module]).join(", ")}.{" "}
            <Link
              href={automationHref("settings")}
              className="font-medium text-brand hover:underline"
            >
              Allow it in Settings
            </Link>
          </p>
        ) : null}
        <Button variant="soft" size="sm" onClick={onUse}>
          Use template
          <span className="sr-only">: {template.title}</span>
        </Button>
      </div>
    </li>
  );
}
