"use client";

import type { AiProposal } from "@orbit/contracts";
import { Check, CheckCheck, CircleAlert, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useDecideProposal, useUpdateAiSettings } from "@/hooks/use-ai";
import { canAlwaysAdd, recordHref } from "@/lib/ai";

const KIND_LABELS: Record<AiProposal["kind"], string> = {
  create_task: "New task",
  create_reminder: "New reminder",
  create_event: "New event",
  create_note: "New note",
  append_to_note: "Add to note",
  add_note_tags: "Tag note",
  update_document_details: "Document details",
  add_shopping_item: "Shopping item",
  create_habit: "New habit",
  log_water: "Log water",
  log_weight: "Log weight",
  log_activity: "Log activity",
  add_transaction: "New transaction",
  add_place: "New place",
  add_person: "New person",
  save_link: "Save link",
  add_watch_item: "Add to watchlist",
};

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  priority: "Priority",
  due_date: "Due",
  start_date: "Date",
  time_of_day: "Time",
  start: "Starts",
  end: "Ends",
  location: "Where",
  tags: "Tags",
  text: "Text",
  provider: "Provider",
  issuing_authority: "Issued by",
  reference_number: "Reference",
  issue_date: "Issued",
  effective_date: "Effective",
  expiry_date: "Expires",
  renewal_date: "Renews",
  name: "Name",
  quantity: "Quantity",
  notes: "Notes",
  note: "Note",
  list_name: "List",
  weekdays: "Days",
  times_per_week: "Times a week",
  amount_ml: "Water (ml)",
  weight_kg: "Weight (kg)",
  kind: "Type",
  duration_minutes: "Minutes",
  distance_km: "Distance (km)",
  steps: "Steps",
  day: "Day",
  type: "Type",
  amount: "Amount",
  occurred_on: "Date",
  account: "Account",
  category: "Category",
  country_code: "Country",
  locality: "Area",
  status: "Status",
  visited_on: "Visited",
  url: "Link",
  platform: "Platform",
  recommended_by: "Recommended by",
  release_year: "Year",
};

function fields(payload: AiProposal["payload"]): [string, string][] {
  return Object.entries(payload)
    .filter(([key]) => key in FIELD_LABELS)
    .map(([key, value]) => {
      const text = Array.isArray(value) ? value.join(", ") : String(value);
      return [FIELD_LABELS[key] ?? key, text.length > 240 ? `${text.slice(0, 240)}…` : text];
    });
}

/**
 * An action the AI proposed, shown in full before anything happens. Nothing changes until the
 * person approves; approval runs it once through the module's own rules.
 */
export function ProposalCard({
  proposal: initial,
  offerAlways = false,
}: {
  proposal: AiProposal;
  /** Offer to stop asking for simple items like this one. */
  offerAlways?: boolean;
}) {
  const [proposal, setProposal] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const decide = useDecideProposal();
  const updateSettings = useUpdateAiSettings();

  const act = (decision: "approve" | "reject") => {
    setError(null);
    decide.mutate(
      { id: proposal.id, decision },
      {
        onSuccess: setProposal,
        onError: (cause) => setError(describeApiError(cause, "That didn’t work. Try again.")),
      },
    );
  };

  const alwaysAdd = () => {
    setError(null);
    updateSettings.mutate(
      { auto_capture: true },
      {
        onSuccess: () => act("approve"),
        onError: (cause) => setError(describeApiError(cause, "That didn’t work. Try again.")),
      },
    );
  };
  const busy = decide.isPending || updateSettings.isPending;

  const result =
    proposal.status === "executed" && proposal.result_kind
      ? recordHref({
          kind: proposal.result_kind,
          id: proposal.result_id,
          title: "",
          day: null,
          detail: "",
        })
      : null;

  return (
    <section
      aria-label={`Proposed: ${proposal.summary}`}
      className="space-y-3 rounded-2xl border bg-card p-4 shadow-elevation-1"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {KIND_LABELS[proposal.kind]}
            {proposal.status === "pending" ? " · needs your approval" : ""}
          </p>
          <p className="text-sm font-medium">{proposal.summary}</p>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {fields(proposal.payload).map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {proposal.from_untrusted_context && proposal.status === "pending" ? (
        <p className="flex gap-2 rounded-lg bg-warning/10 p-2 text-xs text-foreground [&_svg]:text-warning">
          <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
          Suggested after reading your records. Check the details before approving.
        </p>
      ) : null}
      {proposal.status === "pending" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => act("approve")} disabled={busy}>
            <Check aria-hidden="true" />
            Approve once
          </Button>
          {offerAlways && canAlwaysAdd(proposal.kind) ? (
            <Button size="sm" variant="soft" onClick={alwaysAdd} disabled={busy}>
              <CheckCheck aria-hidden="true" />
              Always add
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => act("reject")} disabled={busy}>
            <X aria-hidden="true" />
            Reject
          </Button>
        </div>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          {proposal.status === "executed" ? (
            <>
              Done.{" "}
              {result ? (
                <Link href={result} className="font-medium text-brand hover:underline">
                  Open it
                </Link>
              ) : null}
            </>
          ) : proposal.status === "rejected" ? (
            "Rejected. Nothing was changed."
          ) : proposal.status === "failed" ? (
            `Couldn’t do it: ${proposal.error ?? "the module refused it."}`
          ) : (
            "Working on it…"
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
