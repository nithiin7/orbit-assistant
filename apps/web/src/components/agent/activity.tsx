"use client";

import type { AgentExecution, AgentExecutionStatus, AgentExecutionStep } from "@orbit/contracts";
import { ArrowLeft, History, RotateCcw, Square } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAgentExecution, useAgentExecutions, useChangeExecution } from "@/hooks/use-agent";
import { useViewerTimeZone } from "@/hooks/use-calendar";
import {
  ACTIVE_STATUSES,
  automationHref,
  formatDuration,
  formatWhen,
  STEP_STATUS_LABELS,
  TRIGGER_LABELS,
} from "@/lib/agent";
import { recordHref } from "@/lib/ai";
import { cn } from "@/utils/common";

import { ApprovalCard } from "./approvals";
import { ErrorNote, ExecutionStatusBadge, LoadingRows, SectionHeading } from "./shared";

const FILTERS: readonly { value: string; label: string; status: AgentExecutionStatus[] }[] = [
  { value: "all", label: "All", status: [] },
  {
    value: "active",
    label: "Running",
    status: ["queued", "running", "waiting", "waiting_approval"],
  },
  { value: "failed", label: "Failed", status: ["failed"] },
];

export function ExecutionRow({ execution }: { execution: AgentExecution }) {
  const timeZone = useViewerTimeZone();
  return (
    <li>
      <Link
        href={automationHref("activity", { run: execution.id })}
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 space-y-0.5">
          <span className="block truncate text-sm font-medium">{execution.title}</span>
          <span className="block text-xs text-muted-foreground">
            {TRIGGER_LABELS[execution.trigger_kind]} · {formatWhen(execution.created_at, timeZone)}
          </span>
        </span>
        <ExecutionStatusBadge status={execution.status} />
      </Link>
    </li>
  );
}

/** Every run, filterable by status; a run's steps open in place. */
export function ActivityView({ runId, filter }: { runId: string | null; filter: string }) {
  if (runId) return <ExecutionDetail executionId={runId} />;
  const current = FILTERS.find((option) => option.value === filter) ?? FILTERS[0];
  return <ExecutionList filter={current?.value ?? "all"} status={current?.status ?? []} />;
}

function ExecutionList({ filter, status }: { filter: string; status: AgentExecutionStatus[] }) {
  const executions = useAgentExecutions({ status, limit: 100 });
  return (
    <div className="space-y-4">
      <SectionHeading title="History" />
      <nav aria-label="Filter runs" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex gap-1">
          {FILTERS.map((option) => (
            <li key={option.value}>
              <Link
                href={automationHref(
                  "activity",
                  option.value === "all" ? {} : { status: option.value },
                )}
                aria-current={option.value === filter ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-full px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  option.value === filter
                    ? "bg-brand-subtle text-brand"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {option.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {executions.status === "loading" ? (
        <LoadingRows label="Loading activity" />
      ) : executions.status === "error" ? (
        <ErrorNote message={executions.message} />
      ) : executions.data.executions.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nothing here yet"
          description="Every run shows up here, step by step."
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {executions.data.executions.map((execution) => (
            <ExecutionRow key={execution.id} execution={execution} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StepItem({ step }: { step: AgentExecutionStep }) {
  const args = Object.entries(step.arguments);
  const failed = step.status === "failed" || step.status === "denied";
  return (
    <li className="relative space-y-1.5 border-l-2 pb-5 pl-4 last:pb-0">
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1 -left-[7px] size-3 rounded-full border-2 bg-card",
          failed
            ? "border-destructive"
            : step.status === "succeeded"
              ? "border-success"
              : "border-muted-foreground",
        )}
      />
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{step.title}</p>
        <Badge variant={failed ? "outline" : "default"}>{STEP_STATUS_LABELS[step.status]}</Badge>
        {step.autonomous ? <Badge variant="brand">Ran automatically</Badge> : null}
      </div>
      {step.reason ? <p className="text-xs text-muted-foreground">Why: {step.reason}</p> : null}
      {args.length ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Details</summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-md bg-muted/50 p-2">
            {args.map(([key, raw]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{key.replaceAll("_", " ")}</dt>
                <dd className="break-words">
                  {typeof raw === "string" ? raw : JSON.stringify(raw)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      {step.output ? (
        <p className="text-sm whitespace-pre-line text-foreground/90">
          {step.output.slice(0, 1200)}
        </p>
      ) : null}
      {step.error ? <p className="text-xs text-destructive">{step.error}</p> : null}
      {step.records.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {step.records.slice(0, 8).map((ref) => {
            const href = recordHref(ref);
            return (
              <li key={`${ref.kind}-${ref.id ?? ref.title}`}>
                {href ? (
                  <Link href={href} className="text-xs font-medium text-brand hover:underline">
                    {ref.title}
                  </Link>
                ) : (
                  <span className="text-xs">{ref.title}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export function ExecutionDetail({ executionId }: { executionId: string }) {
  const timeZone = useViewerTimeZone();
  const detail = useAgentExecution(executionId);
  const change = useChangeExecution();
  const [error, setError] = useState<string | null>(null);

  const act = (action: "cancel" | "retry") => {
    setError(null);
    change.mutate(
      { id: executionId, action },
      { onError: (cause) => setError(describeApiError(cause, "That didn’t work. Try again.")) },
    );
  };

  return (
    <div className="space-y-5">
      <Link
        href={automationHref("activity")}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        History
      </Link>
      {detail.status === "loading" ? (
        <LoadingRows label="Loading the run" />
      ) : detail.status === "error" ? (
        <ErrorNote message={detail.message} />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{detail.data.execution.title}</h2>
              <p className="text-sm text-muted-foreground">
                {TRIGGER_LABELS[detail.data.execution.trigger_kind]} ·{" "}
                {formatWhen(detail.data.execution.created_at, timeZone)}
                {formatDuration(detail.data.execution.started_at, detail.data.execution.finished_at)
                  ? ` · took ${formatDuration(detail.data.execution.started_at, detail.data.execution.finished_at) ?? ""}`
                  : ""}
              </p>
              <ExecutionStatusBadge status={detail.data.execution.status} />
            </div>
            <div className="flex gap-2">
              {ACTIVE_STATUSES.has(detail.data.execution.status) ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => act("cancel")}
                  disabled={change.isPending}
                >
                  <Square aria-hidden="true" />
                  Cancel
                </Button>
              ) : null}
              {detail.data.execution.status === "failed" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => act("retry")}
                  disabled={change.isPending}
                >
                  <RotateCcw aria-hidden="true" />
                  Retry
                </Button>
              ) : null}
            </div>
          </div>
          <FormAlert message={error} />
          {detail.data.execution.goal ? (
            <p className="rounded-lg bg-muted/50 p-3 text-sm">
              <span className="font-medium">You asked: </span>
              {detail.data.execution.goal}
            </p>
          ) : null}
          {detail.data.execution.summary ? (
            <div className="space-y-1 rounded-lg border p-3">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Result
              </p>
              <p className="text-sm whitespace-pre-line">{detail.data.execution.summary}</p>
            </div>
          ) : null}
          {detail.data.execution.error ? (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {detail.data.execution.error}
            </p>
          ) : null}
          {detail.data.approvals.some((a) => a.status === "pending") ? (
            <div className="space-y-3">
              {detail.data.approvals
                .filter((a) => a.status === "pending")
                .map((approval) => (
                  <ApprovalCard key={approval.id} approval={approval} />
                ))}
            </div>
          ) : null}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Steps</h3>
            {detail.data.steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No steps yet. It starts shortly.</p>
            ) : (
              <ol className="ml-1.5">
                {detail.data.steps.map((step) => (
                  <StepItem key={step.id} step={step} />
                ))}
              </ol>
            )}
            <p className="text-xs text-muted-foreground">
              {detail.data.execution.tool_calls} tool call(s)
              {detail.data.execution.input_tokens + detail.data.execution.output_tokens > 0
                ? ` · ${detail.data.execution.input_tokens + detail.data.execution.output_tokens} AI tokens`
                : ""}
              {detail.data.execution.attempts > 1
                ? ` · ${detail.data.execution.attempts} attempts`
                : ""}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
