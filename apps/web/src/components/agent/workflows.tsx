"use client";

import type { AgentTool, AgentWorkflow } from "@orbit/contracts";
import { Pencil, Play, Plus, Sparkles, Trash2, Workflow } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Switch } from "@/components/ui/switch";
import {
  useAgentTools,
  useAgentWorkflows,
  useSaveWorkflow,
  useWorkflowActions,
} from "@/hooks/use-agent";
import { useViewerTimeZone } from "@/hooks/use-calendar";
import {
  automationHref,
  describeTrigger,
  formatWhen,
  WORKFLOW_TEMPLATES,
  type WorkflowFormValues,
  workflowFormValues,
  workflowRequest,
} from "@/lib/agent";

import { ErrorNote, LoadingRows, SectionHeading } from "./shared";
import { WorkflowEditor } from "./workflow-editor";

type Editing = { id: string | null; title: string; initial: WorkflowFormValues };

export function WorkflowsView({ enabled }: { enabled: boolean }) {
  const timeZone = useViewerTimeZone();
  const workflows = useAgentWorkflows();
  const tools = useAgentTools();
  const save = useSaveWorkflow();
  const [editing, setEditing] = useState<Editing | null>(null);
  const toolList: readonly AgentTool[] = tools.status === "success" ? tools.data.tools : [];

  const start = (template: (typeof WORKFLOW_TEMPLATES)[number] | null) =>
    setEditing({
      id: null,
      title: template ? template.title : "New workflow",
      initial: workflowFormValues(template ? template.workflow(timeZone) : null, timeZone),
    });

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Workflows"
        description="Steps Orbit runs in order, on a schedule, when something happens, or when you ask."
        actions={
          <Menu
            align="end"
            items={[
              { id: "blank", label: "Blank workflow", icon: Plus, onSelect: () => start(null) },
              ...WORKFLOW_TEMPLATES.map((template) => ({
                id: template.id,
                label: template.title,
                description: template.description,
                icon: Sparkles,
                group: "Start from a template",
                onSelect: () => start(template),
              })),
            ]}
          >
            <Plus aria-hidden="true" />
            New workflow
          </Menu>
        }
      />
      {!enabled ? (
        <p className="rounded-lg bg-warning/10 p-3 text-sm">
          The agent is off, so workflows don’t run. Turn it on in the Overview.
        </p>
      ) : null}
      {workflows.status === "loading" ? (
        <LoadingRows label="Loading workflows" />
      ) : workflows.status === "error" ? (
        <ErrorNote message={workflows.message} />
      ) : workflows.data.workflows.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No workflows yet"
          description="Start from a template, like a morning briefing or renewal reminders, or build your own."
        >
          <Button variant="soft" onClick={() => start(WORKFLOW_TEMPLATES[0] ?? null)}>
            <Sparkles aria-hidden="true" />
            Try the morning briefing
          </Button>
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {workflows.data.workflows.map((workflow) => (
            <WorkflowRow
              key={workflow.id}
              workflow={workflow}
              timeZone={timeZone}
              onEdit={() =>
                setEditing({
                  id: workflow.id,
                  title: "Edit workflow",
                  initial: workflowFormValues(workflow, timeZone),
                })
              }
            />
          ))}
        </ul>
      )}
      {editing ? (
        <WorkflowEditor
          title={editing.title}
          initial={editing.initial}
          tools={toolList}
          onSave={(values) =>
            save.mutateAsync({ id: editing.id, body: workflowRequest(values, toolList) })
          }
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function WorkflowRow({
  workflow,
  timeZone,
  onEdit,
}: {
  workflow: AgentWorkflow;
  timeZone: string;
  onEdit: () => void;
}) {
  const { setEnabled, remove, run } = useWorkflowActions();
  const { confirm, confirmDialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const fail = (fallback: string) => (cause: unknown) =>
    setError(describeApiError(cause, fallback));

  return (
    <li className="space-y-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium">{workflow.name}</p>
          <p className="text-sm text-muted-foreground">
            {describeTrigger(workflow.trigger)} · {workflow.steps.length} step
            {workflow.steps.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-muted-foreground">
            {workflow.enabled && workflow.next_run_at
              ? `Next run ${formatWhen(workflow.next_run_at, timeZone)}`
              : workflow.last_run_at
                ? `Last run ${formatWhen(workflow.last_run_at, timeZone)}`
                : "Hasn’t run yet"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Switch
            checked={workflow.enabled}
            aria-label={`${workflow.name} on`}
            disabled={setEnabled.isPending}
            onCheckedChange={(enabled) =>
              setEnabled.mutate(
                { id: workflow.id, enabled },
                { onError: fail("Couldn’t change it.") },
              )
            }
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={run.isPending}
            onClick={() => {
              setError(null);
              run.mutate(
                { id: workflow.id, key: crypto.randomUUID() },
                {
                  onSuccess: (execution) => setStarted(execution.id),
                  onError: fail("Couldn’t start it."),
                },
              );
            }}
          >
            <Play aria-hidden="true" />
            Run now
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={`Edit ${workflow.name}`}
            onClick={onEdit}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={`Delete ${workflow.name}`}
            onClick={() => {
              void confirm({
                title: `Delete “${workflow.name}”?`,
                description: "Runs waiting to continue are cancelled. Past activity stays.",
                confirmLabel: "Delete",
                destructive: true,
              }).then((yes) => {
                if (yes) remove.mutate(workflow.id, { onError: fail("Couldn’t delete it.") });
              });
            }}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
      {started ? (
        <p role="status" className="text-xs text-muted-foreground">
          Started.{" "}
          <Link
            href={automationHref("activity", { run: started })}
            className="font-medium text-brand hover:underline"
          >
            Follow it in Activity
          </Link>
        </p>
      ) : null}
      <FormAlert message={error} />
      {confirmDialog}
    </li>
  );
}
