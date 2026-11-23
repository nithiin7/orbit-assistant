"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { AgentExecution, AgentOverview } from "@orbit/contracts";
import {
  ArrowRight,
  Bot,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  FileText,
  Hand,
  HeartPulse,
  History,
  ListChecks,
  type LucideIcon,
  Send,
  Sparkles,
  Sunrise,
  Wallet,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId, useState } from "react";
import { useForm } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { IconChip, type IconChipTone } from "@/components/ui/icon-chip";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useAgentApprovals,
  useAgentWorkflows,
  useStartAgentRun,
  useUpdateAgent,
} from "@/hooks/use-agent";
import { useViewerTimeZone } from "@/hooks/use-calendar";
import {
  automationHref,
  AUTONOMY_LEVELS,
  describeTrigger,
  findTemplate,
  formatWhen,
  goalSchema,
  type TemplateCategory,
  type WorkflowTemplate,
} from "@/lib/agent";
import { cn } from "@/utils/common";

import { ExecutionRow } from "./activity";
import { ApprovalCard } from "./approvals";
import { ErrorNote, LoadingRows } from "./shared";

export function OverviewView({ overview }: { overview: AgentOverview }) {
  const hasWorkflows = overview.workflows > 0;
  return (
    <div className="space-y-6">
      <AgentHero overview={overview} />

      {overview.pending_approvals > 0 ? (
        <PendingPreview count={overview.pending_approvals} />
      ) : null}

      <div className={cn("grid items-start gap-6", hasWorkflows && "@4xl:grid-cols-2")}>
        {hasWorkflows ? <UpNext /> : null}
        <Recent recent={overview.recent} />
      </div>

      <IdeasToTry first={!hasWorkflows} />
    </div>
  );
}

/** The agent itself: who it is, how much it may do alone, and a place to ask it something. */
function AgentHero({ overview }: { overview: AgentOverview }) {
  const { agent, runtime } = overview;
  const update = useUpdateAgent();
  const [error, setError] = useState<string | null>(null);
  const level = AUTONOMY_LEVELS.find((option) => option.value === agent.autonomy);

  return (
    <section
      aria-label="Agent status"
      className="relative overflow-hidden rounded-2xl border bg-linear-to-br from-brand-subtle/60 via-card to-card shadow-elevation-1"
    >
      <Bot
        aria-hidden="true"
        className="pointer-events-none absolute -top-8 -right-8 size-44 -rotate-12 text-brand opacity-[0.05]"
      />
      {/* A soft glow behind the header, in the brand's colors, fading out fully inside the card. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(36rem_14rem_at_0%_0%,color-mix(in_oklch,var(--brand)_12%,transparent),transparent),radial-gradient(30rem_12rem_at_100%_0%,color-mix(in_oklch,var(--brand-2)_14%,transparent),transparent)]"
      />
      <div className="relative space-y-5 p-5 @3xl:p-6">
        <div className="flex items-start gap-4">
          <span className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-brand to-brand-2 shadow-elevation-2">
            <Bot className="size-6 text-white" aria-hidden="true" />
            <span
              aria-hidden="true"
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-card",
                agent.enabled ? "bg-success" : "bg-muted-foreground/50",
              )}
            />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-xs font-medium tracking-wide text-brand uppercase">Your agent</p>
            <p className="truncate text-xl font-semibold tracking-tight @3xl:text-2xl">
              {agent.name}
            </p>
            <p className="text-sm text-muted-foreground">
              {agent.enabled ? "On" : "Off"} · {level?.label ?? agent.autonomy}{" "}
              <Link
                href={automationHref("settings")}
                className="font-medium text-brand hover:underline"
              >
                Change
              </Link>
            </p>
            {level ? <p className="text-xs text-muted-foreground">{level.description}</p> : null}
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

        <AtAGlance overview={overview} />

        {agent.enabled ? (
          <AskAgent />
        ) : runtime.server_enabled ? (
          <p className="rounded-xl border border-dashed bg-card/60 p-4 text-sm text-muted-foreground">
            Turn the agent on to ask it for help and let your workflows run. It always asks before
            changing anything you haven’t allowed.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Requests that show what the agent is good at; choosing one fills the box. */
const SUGGESTIONS = [
  "Plan my week",
  "What’s overdue?",
  "Summarize today’s calendar",
  "Which bills are due soon?",
];

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
    setValue,
    setFocus,
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
    <section className="space-y-3 border-t pt-5">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Sparkles className="size-4 text-brand" aria-hidden="true" />
        Ask the agent
      </h2>
      <form noValidate onSubmit={(event) => void handleSubmit(submit)(event)} className="space-y-3">
        <label htmlFor={`${id}-goal`} className="sr-only">
          What should the agent do?
        </label>
        <Textarea
          id={`${id}-goal`}
          rows={3}
          className="bg-background"
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Suggestions" className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  setValue("goal", suggestion, { shouldValidate: Boolean(errors.goal) });
                  setFocus("goal");
                }}
                className="h-7 rounded-full border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-150 outline-none hover:border-brand/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {suggestion}
              </button>
            ))}
          </div>
          <Button type="submit" disabled={isSubmitting}>
            <Send aria-hidden="true" />
            {isSubmitting ? "Starting…" : "Start"}
          </Button>
        </div>
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
      </form>
    </section>
  );
}

/** Headline figures; each opens the section it summarizes. */
function AtAGlance({ overview }: { overview: AgentOverview }) {
  const finished = overview.recent.filter(
    (run) => run.status === "succeeded" || run.status === "failed",
  );
  const succeeded = finished.filter((run) => run.status === "succeeded").length;
  return (
    <section aria-label="At a glance">
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
        <Stat
          label="Workflows on"
          value={overview.enabled_workflows}
          icon={Workflow}
          accent="bg-brand-subtle text-brand"
          href={automationHref("workflows")}
        >
          {overview.workflows === 0 ? "None yet" : `of ${overview.workflows} in all`}
        </Stat>
        <Stat
          label="Needs you"
          value={overview.pending_approvals}
          icon={Hand}
          accent={
            overview.pending_approvals > 0
              ? "bg-warning/15 text-warning"
              : "bg-muted text-muted-foreground"
          }
          href={automationHref("approvals")}
        >
          {overview.pending_approvals === 0 ? "Nothing waiting" : "Waiting for your answer"}
        </Stat>
        <Stat
          label="Recent runs"
          value={finished.length === 0 ? "—" : `${succeeded}/${finished.length}`}
          icon={CircleCheck}
          accent="bg-success/12 text-success"
          href={automationHref("activity")}
        >
          {finished.length === 0 ? "Nothing has finished yet" : "Finished without a problem"}
        </Stat>
      </dl>
    </section>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  accent,
  href,
  children,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  accent: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <div className="relative min-w-0 rounded-xl border bg-card/80 p-4 backdrop-blur-sm transition-[border-color,translate] duration-150 focus-within:ring-2 focus-within:ring-ring hover:-translate-y-0.5 hover:border-brand/40 motion-reduce:hover:translate-y-0">
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-4 right-4 flex size-9 items-center justify-center rounded-lg",
          accent,
        )}
      >
        <Icon className="size-[1.125rem]" />
      </span>
      <dt className="pr-12 text-sm text-muted-foreground">
        {/* The whole tile is the link; the label names it. */}
        <Link href={href} className="outline-none after:absolute after:inset-0">
          {label}
        </Link>
      </dt>
      <dd className="mt-1 pr-12 text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs text-muted-foreground">{children}</dd>
    </div>
  );
}

function PendingPreview({ count }: { count: number }) {
  const approvals = useAgentApprovals(["pending"]);
  return (
    <SectionCard
      title={`Needs you (${count})`}
      icon={Hand}
      tone="warning"
      className="border-warning/30"
      action={<More href={automationHref("approvals")}>All approvals</More>}
    >
      {approvals.status === "success" ? (
        <div className="grid gap-3 @3xl:grid-cols-2">
          {approvals.data.approvals.slice(0, 2).map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}
        </div>
      ) : null}
    </SectionCard>
  );
}

/** Workflows that will start on their own, soonest first. */
function UpNext() {
  const workflows = useAgentWorkflows();
  const timeZone = useViewerTimeZone();
  const scheduled =
    workflows.status === "success"
      ? workflows.data.workflows
          .filter((workflow) => workflow.enabled && workflow.next_run_at)
          .sort((a, b) => Date.parse(a.next_run_at ?? "") - Date.parse(b.next_run_at ?? ""))
          .slice(0, 4)
      : [];

  return (
    <SectionCard
      title="Up next"
      icon={CalendarClock}
      tone="brand"
      action={<More href={automationHref("workflows")}>Workflows</More>}
    >
      {workflows.status === "loading" ? (
        <LoadingRows label="Loading workflows" rows={2} />
      ) : workflows.status === "error" ? (
        <ErrorNote message={workflows.message} />
      ) : scheduled.length === 0 ? (
        <QuietState icon={CalendarClock}>Nothing is scheduled to run on its own.</QuietState>
      ) : (
        <ul className="-mx-4 divide-y border-t @3xl:-mx-5">
          {scheduled.map((workflow) => (
            <li key={workflow.id} className="flex items-center gap-3 px-4 py-2.5 @3xl:px-5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
                <CalendarClock className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block truncate text-sm font-medium">{workflow.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {describeTrigger(workflow.trigger)}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatWhen(workflow.next_run_at, timeZone)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function Recent({ recent }: { recent: readonly AgentExecution[] }) {
  return (
    <SectionCard
      title="Recent"
      icon={History}
      tone="success"
      action={<More href={automationHref("activity")}>History</More>}
    >
      {recent.length === 0 ? (
        <QuietState icon={History}>
          Nothing has run yet. Ask the agent something or start a workflow, and it shows up here.
        </QuietState>
      ) : (
        <ul className="-mx-4 divide-y border-t px-1 pt-1 @3xl:-mx-5">
          {recent.slice(0, 5).map((execution) => (
            <ExecutionRow key={execution.id} execution={execution} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function QuietState({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed bg-background/40 p-4 text-sm text-muted-foreground">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <p>{children}</p>
    </div>
  );
}

const CATEGORY_ICONS: Record<TemplateCategory, LucideIcon> = {
  planning: Sunrise,
  tasks: ListChecks,
  money: Wallet,
  documents: FileText,
  wellbeing: HeartPulse,
};

/** Templates that show the range of what workflows can do, using modules allowed by default. */
const FEATURED = ["briefing", "week", "busy"]
  .map(findTemplate)
  .filter((template): template is WorkflowTemplate => template !== undefined);

function IdeasToTry({ first }: { first: boolean }) {
  return (
    <SectionCard
      title={first ? "Try a template" : "More ideas"}
      description={
        first ? "Start from a ready-made workflow. Nothing is saved until you do." : undefined
      }
      icon={Sparkles}
      tone="violet"
      action={<More href={automationHref("workflows")}>All templates</More>}
    >
      <ul className="grid gap-3 @3xl:grid-cols-3">
        {FEATURED.map((template) => {
          const Icon = CATEGORY_ICONS[template.category];
          return (
            <li key={template.id}>
              <Link
                href={automationHref("workflows", { template: template.id })}
                className="group flex h-full flex-col gap-3 rounded-xl border bg-background/60 p-4 transition-[border-color,background-color,translate] duration-150 outline-none hover:-translate-y-0.5 hover:border-brand/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-brand-subtle text-brand">
                    <Icon className="size-[1.125rem]" aria-hidden="true" />
                  </span>
                  <ArrowRight
                    className="size-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-brand"
                    aria-hidden="true"
                  />
                </span>
                <span className="space-y-1">
                  <span className="block font-medium">{template.title}</span>
                  <span className="block text-sm text-muted-foreground">
                    {template.description}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

/** A link to the full view, at the end of a card's header. */
function More({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group/more -mr-1.5 inline-flex h-7 items-center gap-0.5 rounded-full px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <ChevronRight
        aria-hidden="true"
        className="size-3.5 transition-transform duration-150 group-hover/more:translate-x-0.5"
      />
    </Link>
  );
}

/** One part of the overview as a card: a tinted icon, a title, and a link to the full view. */
function SectionCard({
  title,
  description,
  icon: Icon,
  tone,
  action,
  className,
  children,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  tone: IconChipTone;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "min-w-0 space-y-4 overflow-hidden rounded-2xl border bg-card p-4 shadow-elevation-1 @3xl:p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <IconChip icon={Icon} tone={tone} />
          <div className="min-w-0 space-y-0.5 pt-1">
            <h2 id={id} className="text-sm font-semibold">
              {title}
            </h2>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
