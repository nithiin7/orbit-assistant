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
      <div className="space-y-0.5">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium">{current.summary}</p>
          {current.risk !== "low" ? (
            <Badge variant="outline">{RISK_LABELS[current.risk]}</Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          <Link
            href={automationHref("activity", { run: current.execution_id })}
            className="hover:underline"
          >
            {current.context}
          </Link>{" "}
          · {formatWhen(current.created_at, timeZone)}
        </p>
      </div>
      {current.effect ? (
        <p className="text-sm">
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
      {current.reason ? <p className="text-sm text-muted-foreground">{current.reason}</p> : null}
      {current.from_untrusted_context && pending ? (
        <p className="flex gap-2 rounded-lg bg-warning/10 p-2 text-xs [&_svg]:text-warning">
          <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
          Suggested after reading content that can contain misleading instructions. Check it first.
        </p>
      ) : null}
      {fields.length ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Details
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-muted/50 p-3">
            {fields.map(([key, raw]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{key.replaceAll("_", " ")}</dt>
                <dd className="break-words">{value(raw)}</dd>
              </div>
            ))}
          </dl>
        </details>
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
          <span className="ml-auto text-xs text-muted-foreground">
            Expires {formatWhen(current.expires_at, timeZone)}
          </span>
        </div>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          <DecisionNote approval={current} href={result} />
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

function DecisionNote({ approval, href }: { approval: AgentApproval; href: string | null }) {
  if (approval.status === "executed" && href) {
    return (
      <>
        Done.{" "}
        <Link href={href} className="font-medium text-brand hover:underline">
          Open {approval.result?.title ?? "it"}
        </Link>
      </>
    );
  }
  if (approval.status === "failed") return <>Couldn’t run: {approval.error ?? "it was refused."}</>;
  if (approval.status === "rejected") return <>Rejected. Nothing changed.</>;
  return <>{APPROVAL_STATUS_LABELS[approval.status]}</>;
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
    <div className="space-y-10">
      <section className="space-y-4">
        <SectionHeading title="Approvals" />
        {pending.status === "loading" ? (
          <LoadingRows label="Loading approvals" />
        ) : pending.status === "error" ? (
          <ErrorNote message={pending.message} />
        ) : waiting.length === 0 ? (
          <EmptyState
            icon={Hand}
            title="No approvals waiting"
            description="When something needs your OK, it shows up here."
          />
        ) : (
          <div className="grid gap-3 @3xl:grid-cols-2">
            {waiting.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} />
            ))}
          </div>
        )}
      </section>
      {decided.status === "success" && past.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Earlier</h3>
          <ul className="divide-y rounded-xl border bg-card">
            {past.slice(0, 20).map((approval) => (
              <PastApproval key={approval.id} approval={approval} />
            ))}
          </ul>
        </section>
      ) : decided.status === "error" ? (
        <ErrorNote message={decided.message} />
      ) : null}
    </div>
  );
}

function PastApproval({ approval }: { approval: AgentApproval }) {
  const timeZone = useViewerTimeZone();
  const result = approval.result ? recordHref(approval.result) : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
      <span className="min-w-0">
        <span className="block truncate">{approval.summary}</span>
        <span className="block text-xs text-muted-foreground">
          {formatWhen(approval.created_at, timeZone)}
        </span>
      </span>
      <span className="text-xs text-muted-foreground">
        <DecisionNote approval={approval} href={result} />
      </span>
    </li>
  );
}
