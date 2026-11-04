"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { AgentOverview } from "@orbit/contracts";
import { ArrowRight, Bot, Send } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAgentApprovals, useStartAgentRun, useUpdateAgent } from "@/hooks/use-agent";
import {
  automationHref,
  AUTONOMY_LEVELS,
  findTemplate,
  goalSchema,
  type WorkflowTemplate,
} from "@/lib/agent";

import { ExecutionRow } from "./activity";
import { ApprovalCard } from "./approvals";
import { SectionHeading } from "./shared";

export function OverviewView({ overview }: { overview: AgentOverview }) {
  const { agent, runtime } = overview;
  const update = useUpdateAgent();
  const [error, setError] = useState<string | null>(null);
  const level = AUTONOMY_LEVELS.find((option) => option.value === agent.autonomy);

  return (
    <div className="space-y-8">
      <section aria-label="Agent status" className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-brand to-brand-2 shadow-elevation-2">
            <Bot className="size-5 text-white" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{agent.name}</p>
            <p className="text-sm text-muted-foreground">
              {agent.enabled ? "On" : "Off"} · {level?.label ?? agent.autonomy}{" "}
              <Link
                href={automationHref("settings")}
                className="font-medium text-brand hover:underline"
              >
                Change
              </Link>
            </p>
          </div>
          <Switch
            checked={agent.enabled}
            aria-label="Agent on"
            disabled={update.isPending || !runtime.server_enabled}
            onCheckedChange={(enabled) => {
              setError(null);
              update.mutate(
                { enabled },
                { onError: (cause) => setError(describeApiError(cause, "Couldn’t change it.")) },
              );
            }}
          />
        </div>
        {!runtime.server_enabled ? (
          <p className="text-sm text-muted-foreground">Automation is turned off on this server.</p>
        ) : null}
        <FormAlert message={error} />
      </section>

      {agent.enabled ? <AskAgent /> : null}

      {overview.pending_approvals > 0 ? (
        <PendingPreview count={overview.pending_approvals} />
      ) : null}

      {overview.workflows === 0 ? <IdeasToTry /> : null}

      <section className="space-y-3">
        <SectionHeading
          title="Recent"
          actions={
            <Link
              href={automationHref("activity")}
              className="text-sm font-medium text-brand hover:underline"
            >
              History
            </Link>
          }
        />
        {overview.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has run yet.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {overview.recent.slice(0, 5).map((execution) => (
              <ExecutionRow key={execution.id} execution={execution} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Templates that show the range of what workflows can do, using modules allowed by default. */
const FEATURED = ["briefing", "week", "busy"]
  .map(findTemplate)
  .filter((template): template is WorkflowTemplate => template !== undefined);

function IdeasToTry() {
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Try a template"
        actions={
          <Link
            href={automationHref("workflows")}
            className="text-sm font-medium text-brand hover:underline"
          >
            All templates
          </Link>
        }
      />
      <ul className="grid gap-3 @3xl:grid-cols-3">
        {FEATURED.map((template) => (
          <li key={template.id}>
            <Link
              href={automationHref("workflows", { template: template.id })}
              className="group flex h-full flex-col gap-1 rounded-xl border bg-card p-4 transition-colors duration-150 outline-none hover:border-brand/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-center justify-between gap-2 font-medium">
                {template.title}
                <ArrowRight
                  className="size-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </span>
              <span className="text-sm text-muted-foreground">{template.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PendingPreview({ count }: { count: number }) {
  const approvals = useAgentApprovals(["pending"]);
  return (
    <section className="space-y-3">
      <SectionHeading
        title={`Needs you (${count})`}
        actions={
          <Link
            href={automationHref("approvals")}
            className="text-sm font-medium text-brand hover:underline"
          >
            All approvals
          </Link>
        }
      />
      {approvals.status === "success" ? (
        <div className="grid gap-3 @3xl:grid-cols-2">
          {approvals.data.approvals.slice(0, 2).map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** A request for the agent: it plans with its tools and asks before changing anything. */
function AskAgent() {
  const id = useId();
  const start = useStartAgentRun();
  const [started, setStarted] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: yupResolver(goalSchema), defaultValues: { goal: "" } });

  async function submit({ goal }: InferType<typeof goalSchema>) {
    try {
      const execution = await start.mutateAsync({ goal, key: crypto.randomUUID() });
      setStarted(execution.id);
      reset();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t start it. Try again."),
      });
    }
  }

  return (
    <section className="space-y-3">
      <SectionHeading title="Ask the agent" />
      <form noValidate onSubmit={(event) => void handleSubmit(submit)(event)} className="space-y-2">
        <label htmlFor={`${id}-goal`} className="sr-only">
          What should the agent do?
        </label>
        <Textarea
          id={`${id}-goal`}
          rows={2}
          placeholder="Find my overdue tasks and draft a plan for this week."
          aria-invalid={Boolean(errors.goal)}
          aria-describedby={errors.goal ? `${id}-error` : undefined}
          {...register("goal")}
        />
        {errors.goal ? (
          <p id={`${id}-error`} className="text-xs text-destructive">
            {errors.goal.message}
          </p>
        ) : null}
        <FormAlert message={errors.root?.server?.message ?? null} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isSubmitting}>
            <Send aria-hidden="true" />
            {isSubmitting ? "Starting…" : "Start"}
          </Button>
          {started ? (
            <p role="status" className="text-sm text-muted-foreground">
              Started.{" "}
              <Link
                href={automationHref("activity", { run: started })}
                className="font-medium text-brand hover:underline"
              >
                Follow it
              </Link>
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
