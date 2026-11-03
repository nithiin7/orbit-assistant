"use client";

import type { AgentApproval } from "@orbit/contracts";
import { Check, CircleAlert, Hand, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAgentApprovals, useDecideApproval } from "@/hooks/use-agent";
import { useViewerTimeZone } from "@/hooks/use-calendar";
import { APPROVAL_STATUS_LABELS, automationHref, formatWhen } from "@/lib/agent";
import { recordHref } from "@/lib/ai";

import { ErrorNote, LoadingRows, SectionHeading } from "./shared";

const RISK_LABELS: Record<AgentApproval["risk"], string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

function value(raw: unknown): string {
  if (Array.isArray(raw)) return raw.map(String).join(", ");
  if (raw === null || raw === undefined) return "";
  const text = typeof raw === "object" ? JSON.stringify(raw) : String(raw);
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

/**
 * One exact action, shown in full before anything happens. Approving sends back the action's
 * fingerprint, so only what is shown here can run.
 */
export function ApprovalCard({ approval }: { approval: AgentApproval }) {
  const timeZone = useViewerTimeZone();
  const decide = useDecideApproval();
  const [current, setCurrent] = useState(approval);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(approval);
  if (seen !== approval) {
    // A refetch brought a newer copy of this approval.
    setSeen(approval);
    setCurrent(approval);
  }

  const act = (decision: "approve" | "reject") => {
    setError(null);
    decide.mutate(
      { approval: current, decision },
      {
        onSuccess: setCurrent,
        onError: (cause) => setError(describeApiError(cause, "That didn’t work. Try again.")),
      },
    );
  };
  const target = current.target ? recordHref(current.target) : null;
  const result = current.result ? recordHref(current.result) : null;
  const pending = current.status === "pending";
  const fields =
    current.tool === "checkpoint"
      ? []
      : Object.entries(current.arguments).filter(([, raw]) => value(raw) !== "");

  return (
    <section
      aria-label={`Approval: ${current.summary}`}
      className="space-y-3 rounded-xl border bg-card p-4 shadow-elevation-1"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs text-muted-foreground">
            <Link
              href={automationHref("activity", { run: current.execution_id })}
              className="hover:underline"
            >
              {current.context}
            </Link>{" "}
            · {formatWhen(current.created_at, timeZone)}
          </p>
          <p className="text-sm font-medium">{current.summary}</p>
        </div>
        <div className="flex gap-1.5">
          <Badge variant={current.risk === "low" ? "default" : "outline"}>
            {RISK_LABELS[current.risk]}
          </Badge>
          {!pending ? (
            <Badge variant="outline">{APPROVAL_STATUS_LABELS[current.status]}</Badge>
          ) : null}
        </div>
      </div>
      {current.reason ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Why: </span>
          {current.reason}
        </p>
      ) : null}
      {current.effect ? (
        <p className="text-sm">
          <span className="font-medium">What changes: </span>
          {current.effect}
          {current.target ? (
            <>
              {" "}
              {target ? (
                <Link href={target} className="font-medium text-brand hover:underline">
                  {current.target.title}
                </Link>
              ) : (
                current.target.title
              )}
            </>
          ) : null}
        </p>
      ) : null}
      {fields.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-muted/50 p-3 text-xs">
          {fields.map(([key, raw]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key.replaceAll("_", " ")}</dt>
              <dd className="break-words">{value(raw)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {current.from_untrusted_context && pending ? (
        <p className="flex gap-2 rounded-lg bg-warning/10 p-2 text-xs [&_svg]:text-warning">
          <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
          Proposed after reading your records or imported content, which can contain misleading
          instructions. Check the details before approving.
        </p>
      ) : null}
      {pending ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => act("approve")} disabled={decide.isPending}>
            <Check aria-hidden="true" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => act("reject")}
            disabled={decide.isPending}
          >
            <X aria-hidden="true" />
            Reject
          </Button>
          <span className="text-xs text-muted-foreground">
            Expires {formatWhen(current.expires_at, timeZone)}
          </span>
        </div>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          {current.status === "executed" && result ? (
            <>
              Done.{" "}
              <Link href={result} className="font-medium text-brand hover:underline">
                Open {current.result?.title ?? "it"}
              </Link>
            </>
          ) : current.status === "failed" ? (
            `Couldn’t run: ${current.error ?? "it was refused."}`
          ) : current.status === "rejected" ? (
            "Rejected. Nothing was changed."
          ) : (
            APPROVAL_STATUS_LABELS[current.status]
          )}
        </p>
      )}
      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </section>
  );
}

const DECIDED: readonly AgentApproval["status"][] = [
  "executed",
  "rejected",
  "expired",
  "cancelled",
  "failed",
];

/** Pending approvals first, then the most recent decisions. */
export function ApprovalCenter() {
  const pending = useAgentApprovals(["pending"]);
  const decided = useAgentApprovals(DECIDED);
  const waiting =
    pending.status === "success"
      ? pending.data.approvals.filter((a) => a.status === "pending")
      : [];
  const past =
    decided.status === "success"
      ? decided.data.approvals.filter((a) => a.status !== "pending")
      : [];

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeading
          title="Waiting for you"
          description="Nothing here runs until you approve it. Approvals expire if left too long."
        />
        {pending.status === "loading" ? (
          <LoadingRows label="Loading approvals" />
        ) : pending.status === "error" ? (
          <ErrorNote message={pending.message} />
        ) : waiting.length === 0 ? (
          <EmptyState
            icon={Hand}
            title="No approvals waiting"
            description="When the agent or a workflow wants to change something, it asks here first."
          />
        ) : (
          <div className="grid gap-3 @3xl:grid-cols-2">
            {waiting.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} />
            ))}
          </div>
        )}
      </section>
      <section className="space-y-3">
        <SectionHeading title="Decided" description="Approved, rejected, expired, and cancelled." />
        {decided.status === "loading" ? (
          <LoadingRows label="Loading past approvals" rows={2} />
        ) : decided.status === "error" ? (
          <ErrorNote message={decided.message} />
        ) : past.length === 0 ? (
          <p className="text-sm text-muted-foreground">No decisions yet.</p>
        ) : (
          <div className="grid gap-3 @3xl:grid-cols-2">
            {past.slice(0, 20).map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
