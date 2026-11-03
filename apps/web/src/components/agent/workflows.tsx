"use client";

import type { Agent, AgentTool, AgentWorkflow } from "@orbit/contracts";
import { MoreHorizontal, Pencil, Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
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
  findTemplate,
  formatWhen,
  type WorkflowFormValues,
  workflowFormValues,
  workflowRequest,
  type WorkflowTemplate,
} from "@/lib/agent";

import { ErrorNote, LoadingRows, SectionHeading } from "./shared";
import { TemplateGallery } from "./templates";
import { WorkflowEditor } from "./workflow-editor";

type Editing = { id: string | null; title: string; initial: WorkflowFormValues };

/**
 * The person's workflows, then templates to start new ones from. `templateId` (from the URL)
 * opens a template in the editor straight away.
 */
export function WorkflowsView({ agent, templateId }: { agent: Agent; templateId: string | null }) {
  const router = useRouter();
  const timeZone = useViewerTimeZone();
  const workflows = useAgentWorkflows();
  const tools = useAgentTools();
  const save = useSaveWorkflow();
  const fromTemplate = (template: WorkflowTemplate): Editing => ({
    id: null,
    title: template.title,
    initial: workflowFormValues(template.workflow(timeZone), timeZone),
  });
  const [editing, setEditing] = useState<Editing | null>(() => {
    const template = findTemplate(templateId);
    return template ? fromTemplate(template) : null;
  });
  const toolList: readonly AgentTool[] = tools.status === "success" ? tools.data.tools : [];
  const hasWorkflows = workflows.status === "success" && workflows.data.workflows.length > 0;

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <SectionHeading
          title="Workflows"
          actions={
            <Button
              onClick={() =>
                setEditing({
                  id: null,
                  title: "New workflow",
                  initial: workflowFormValues(null, timeZone),
                })
              }
            >
              <Plus aria-hidden="true" />
              New workflow
            </Button>
          }
        />
        {!agent.enabled ? (
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm">
            The agent is off, so workflows won’t run.{" "}
            <Link href={automationHref()} className="font-medium text-brand hover:underline">
              Turn it on
            </Link>
          </p>
        ) : null}
        {workflows.status === "loading" ? (
          <LoadingRows label="Loading workflows" />
        ) : workflows.status === "error" ? (
          <ErrorNote message={workflows.message} />
        ) : hasWorkflows ? (
          <ul className="divide-y rounded-xl border bg-card">
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
        ) : (
          <p className="text-sm text-muted-foreground">
            No workflows yet. Start with a template below.
          </p>
        )}
      </section>

      <TemplateGallery
        allowed={agent.modules}
        timeZone={timeZone}
        onUse={(template) => setEditing(fromTemplate(template))}
      />

      {editing ? (
        <WorkflowEditor
          title={editing.title}
          initial={editing.initial}
          tools={toolList}
          onSave={(values) =>
            save.mutateAsync({ id: editing.id, body: workflowRequest(values, toolList) })
          }
          onClose={() => {
            setEditing(null);
            // Drop an opened template from the URL, so a reload doesn't open it again.
            if (templateId) router.replace(automationHref("workflows"));
          }}
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
  const when =
    workflow.enabled && workflow.next_run_at
      ? `Next ${formatWhen(workflow.next_run_at, timeZone)}`
      : workflow.last_run_at
        ? `Last ran ${formatWhen(workflow.last_run_at, timeZone)}`
        : null;

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="block truncate font-medium">{workflow.name}</span>
          <span className="block truncate text-sm text-muted-foreground">
            {describeTrigger(workflow.trigger)}
            {when ? ` · ${when}` : ""}
          </span>
        </button>
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
        <Menu
          aria-label={`Actions for ${workflow.name}`}
          variant="ghost"
          size="icon"
          chevron={false}
          align="end"
          className="size-8"
          items={[
            {
              id: "run",
              label: "Run now",
              icon: Play,
              onSelect: () => {
                setError(null);
                run.mutate(
                  { id: workflow.id, key: crypto.randomUUID() },
                  {
                    onSuccess: (execution) => setStarted(execution.id),
                    onError: fail("Couldn’t start it."),
                  },
                );
              },
            },
            { id: "edit", label: "Edit", icon: Pencil, onSelect: onEdit },
            {
              id: "delete",
              label: "Delete",
              icon: Trash2,
              destructive: true,
              onSelect: () => {
                void confirm({
                  title: `Delete “${workflow.name}”?`,
                  description: "Runs in progress stop. Its history stays.",
                  confirmLabel: "Delete",
                  destructive: true,
                }).then((yes) => {
                  if (yes) remove.mutate(workflow.id, { onError: fail("Couldn’t delete it.") });
                });
              },
            },
          ]}
        >
          <MoreHorizontal aria-hidden="true" />
        </Menu>
      </div>
      {started ? (
        <p role="status" className="text-xs text-muted-foreground">
          Started.{" "}
          <Link
            href={automationHref("activity", { run: started })}
            className="font-medium text-brand hover:underline"
          >
            Follow it
          </Link>
        </p>
      ) : null}
      <FormAlert message={error} />
      {confirmDialog}
    </li>
  );
}
