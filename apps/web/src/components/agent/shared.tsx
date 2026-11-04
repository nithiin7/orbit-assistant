import type { AgentExecutionStatus, AgentRuntime } from "@orbit/contracts";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clock,
  Hand,
  Info,
  LoaderCircle,
} from "lucide-react";
import type { ReactNode } from "react";

import { EXECUTION_STATUS_LABELS } from "@/lib/agent";
import { cn } from "@/utils/common";

const STATUS_STYLE: Record<AgentExecutionStatus, { icon: typeof Clock; className: string }> = {
  queued: { icon: CircleDashed, className: "text-muted-foreground" },
  running: { icon: LoaderCircle, className: "text-brand" },
  waiting: { icon: Clock, className: "text-muted-foreground" },
  waiting_approval: { icon: Hand, className: "text-warning" },
  succeeded: { icon: CircleCheck, className: "text-success" },
  failed: { icon: CircleAlert, className: "text-destructive" },
  cancelled: { icon: CircleSlash, className: "text-muted-foreground" },
};

/** A run's status as an icon and word, never color alone. */
export function ExecutionStatusBadge({ status }: { status: AgentExecutionStatus }) {
  const { icon: Icon, className } = STATUS_STYLE[status];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", className)}>
      <Icon
        className={cn("size-3.5", status === "running" && "motion-safe:animate-spin")}
        aria-hidden="true"
      />
      {EXECUTION_STATUS_LABELS[status]}
    </span>
  );
}

export function SectionHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Where automations run, so it's clear what must be running for them. */
export function RuntimeNote({ runtime }: { runtime: AgentRuntime }) {
  const where =
    runtime.storage_mode === "local"
      ? "Automations run while Orbit is running on this device. Missed runs catch up when it starts."
      : "Automations run on your Orbit server, even when this page is closed.";
  const worker = runtime.worker_embedded ? "" : " The orbit-worker process must be running.";
  return (
    <p className="flex gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {where}
        {worker}
      </span>
    </p>
  );
}

export function LoadingRows({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-14 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
      <CircleAlert className="size-4" aria-hidden="true" />
      {message}
    </p>
  );
}
