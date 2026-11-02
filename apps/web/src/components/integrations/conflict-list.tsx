"use client";

import type { IntegrationConflict, IntegrationConflictResolution } from "@orbit/contracts";
import { GitCompareArrows } from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useConflicts, useResolveConflict } from "@/hooks/use-integrations";
import { PROVIDER_NAMES } from "@/lib/integrations";

import { ErrorText, Section } from "./section";

/**
 * Events changed both in Orbit and at the provider, or deleted at the provider after an Orbit
 * change. Orbit overwrote neither side; the person chooses. Hidden when there are none.
 */
export function ConflictList() {
  const conflicts = useConflicts();
  if (conflicts.status !== "success" || conflicts.data.conflicts.length === 0) return null;
  const list = conflicts.data.conflicts;
  return (
    <Section
      id="conflicts"
      icon={GitCompareArrows}
      title={
        list.length === 1 ? "1 event needs your choice" : `${list.length} events need your choice`
      }
      description="These changed in both places since they were last synchronized. Nothing was overwritten."
    >
      <ul className="space-y-3">
        {list.map((conflict) => (
          <ConflictItem key={conflict.link.id} conflict={conflict} />
        ))}
      </ul>
    </Section>
  );
}

function ConflictItem({ conflict }: { conflict: IntegrationConflict }) {
  const resolve = useResolveConflict();
  const [error, setError] = useState<string | null>(null);
  const provider = PROVIDER_NAMES[conflict.provider];
  const deleted = conflict.link.conflict_kind === "deleted_remotely";

  const choose = (resolution: IntegrationConflictResolution) => {
    setError(null);
    resolve.mutate(
      { linkId: conflict.link.id, resolution },
      { onError: (cause) => setError(describeApiError(cause, "Couldn’t resolve this conflict.")) },
    );
  };

  return (
    <li className="space-y-3 rounded-xl border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">{conflict.link.title}</p>
        <p className="text-xs text-pretty text-muted-foreground">
          {deleted
            ? `Deleted in ${provider} (${conflict.account_email}) after you changed it in Orbit.`
            : `Changed in Orbit and in ${provider} (${conflict.account_email}).`}
        </p>
      </div>
      {conflict.external ? (
        <dl className="grid gap-1 rounded-lg bg-muted/50 p-3 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-3">
          <dt className="font-medium text-muted-foreground">{provider}’s version</dt>
          <dd>
            {conflict.external.title} ·{" "}
            {conflict.external.all_day
              ? conflict.external.start.slice(0, 10)
              : conflict.external.start.replace("T", " ")}
            {conflict.external.location ? ` · ${conflict.external.location}` : ""}
          </dd>
        </dl>
      ) : null}
      <ErrorText message={error} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="soft"
          disabled={resolve.isPending}
          onClick={() => choose("keep_orbit")}
        >
          {deleted ? "Keep it in Orbit" : "Keep Orbit’s version"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={resolve.isPending}
          onClick={() => choose("keep_external")}
        >
          {deleted ? "Delete it in Orbit too" : `Use ${provider}’s version`}
        </Button>
      </div>
    </li>
  );
}
