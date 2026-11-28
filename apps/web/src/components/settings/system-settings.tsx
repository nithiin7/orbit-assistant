"use client";

import type { SystemStatus, UpdateStatus } from "@orbit/contracts";
import {
  Activity,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import {
  PrivacyNote,
  SettingsCard,
  SettingsLoading,
  SettingsSwitch,
} from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { queryResource } from "@/hooks/query-resource";
import { useSystemStatus, useUpdateStatus } from "@/hooks/use-system";
import { settingsSectionsClassName } from "@/lib/settings";
import {
  describeUpdate,
  formatAgo,
  storageLabel,
  systemFeatures,
  type UpdateNotice,
  upgradeGuideUrl,
} from "@/lib/system";
import { cn } from "@/utils/common";

/** For people who self-host: the running version, update notices, and the server's health. */
export function SystemSettings() {
  return (
    <div className={settingsSectionsClassName}>
      <UpdatesCard />
      <HealthCard />
    </div>
  );
}

const NOTICE_ICON = {
  brand: Sparkles,
  success: CircleCheck,
  warning: CircleAlert,
  muted: CircleDashed,
} as const;

const NOTICE_TONE: Record<UpdateNotice["tone"], string> = {
  brand: "bg-brand-subtle text-brand",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  muted: "bg-muted text-muted-foreground",
};

function UpdatesCard() {
  const id = useId();
  const { query, toggle, check } = useUpdateStatus();
  const state = queryResource(query, "Couldn’t load the update status.");
  const [error, setError] = useState<string | null>(null);

  const run = (action: Promise<UpdateStatus>) => {
    setError(null);
    action.catch((reason: unknown) =>
      setError(describeApiError(reason, "Couldn’t save. Try again.")),
    );
  };

  return (
    <SettingsCard
      titleId={`${id}-title`}
      icon={RefreshCw}
      title="Updates"
      description="Hear about new versions of Orbit."
    >
      {state.status === "loading" ? (
        <SettingsLoading label="Loading the update status…" className="h-40" />
      ) : state.status === "error" ? (
        <FormAlert message={state.message} />
      ) : (
        <>
          <UpdateNoticeRow status={state.data} />
          <SettingsSwitch
            label="Check for updates"
            hint="About once a day, the server looks for a newer release."
            checked={state.data.enabled}
            disabled={toggle.isPending}
            onCheckedChange={(checked) => run(toggle.mutateAsync(checked))}
          />
          {state.data.enabled ? (
            <Button
              variant="soft"
              size="sm"
              disabled={check.isPending}
              onClick={() => run(check.mutateAsync())}
            >
              <RefreshCw
                aria-hidden="true"
                className={cn(check.isPending && "motion-safe:animate-spin")}
              />
              {check.isPending ? "Checking…" : "Check now"}
            </Button>
          ) : null}
          <FormAlert message={error} />
          <PrivacyNote>
            Your Orbit server, not your browser, asks GitHub for the latest release of{" "}
            <code className="font-mono">{state.data.repository}</code>. GitHub sees the server’s
            address; nothing about you or your data is sent. This applies to the whole server, for
            everyone who uses it.
          </PrivacyNote>
        </>
      )}
    </SettingsCard>
  );
}

function UpdateNoticeRow({ status }: { status: UpdateStatus }) {
  const notice = describeUpdate(status);
  const Icon = NOTICE_ICON[notice.tone];
  return (
    <div role="status" className="flex items-start gap-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          NOTICE_TONE[notice.tone],
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold">{notice.title}</p>
        <p className="text-sm text-pretty text-muted-foreground">{notice.detail}</p>
        {status.update_available && status.release_url ? (
          <p className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5 text-sm">
            <ExternalLink href={status.release_url}>What’s new</ExternalLink>
            <ExternalLink href={upgradeGuideUrl(status.repository)}>How to upgrade</ExternalLink>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 rounded-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function HealthCard() {
  const id = useId();
  const status = useSystemStatus();
  const state = queryResource(status, "Couldn’t load the server’s status.");

  return (
    <SettingsCard
      titleId={`${id}-title`}
      icon={Activity}
      title="Server health"
      description="What’s running, and whether anything needs your attention."
      action={
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh server health"
          disabled={status.isFetching}
          onClick={() => void status.refetch()}
        >
          <RefreshCw
            aria-hidden="true"
            className={cn(status.isFetching && "motion-safe:animate-spin")}
          />
        </Button>
      }
    >
      {state.status === "loading" ? (
        <SettingsLoading label="Loading the server’s status…" className="h-56" />
      ) : state.status === "error" ? (
        <FormAlert message={state.message} />
      ) : (
        <HealthDetails status={state.data} />
      )}
    </SettingsCard>
  );
}

function HealthDetails({ status }: { status: SystemStatus }) {
  const { database, worker } = status;
  const workerPlace = worker.runs_in_api ? "Runs inside the API." : "Runs as orbit-worker.";
  return (
    <div className="space-y-5">
      <dl className="divide-y divide-border/60 rounded-xl border border-border/60">
        <HealthRow
          label="Version"
          ok
          value={`Orbit ${status.version}`}
          detail={`Started ${formatAgo(status.started_at)}.`}
        />
        <HealthRow label="Storage" ok value={storageLabel(status.storage_mode)} />
        {database.status === "ok" ? (
          <HealthRow
            label="Database"
            ok
            value="Up to date"
            detail={database.revision ? `Schema revision ${database.revision}.` : undefined}
          />
        ) : (
          <HealthRow
            label="Database"
            ok={false}
            value="Needs migrating"
            detail={
              <>
                At revision {database.revision ?? "none"}; this version expects{" "}
                {database.expected_revision ?? "none"}. Back up, then run{" "}
                <code className="font-mono text-xs">pnpm db:migrate</code> and restart the API.
              </>
            }
          />
        )}
        {worker.status === "ok" ? (
          <HealthRow label="Reminder worker" ok value="Delivering reminders" detail={workerPlace} />
        ) : (
          <HealthRow
            label="Reminder worker"
            ok={false}
            value="Reminders are waiting"
            detail={
              worker.runs_in_api ? (
                <>Reminders due minutes ago haven’t gone out. Check the API’s logs.</>
              ) : (
                <>
                  Reminders due minutes ago haven’t gone out. Start the worker with{" "}
                  <code className="font-mono text-xs">uv run orbit-worker</code> in{" "}
                  <code className="font-mono text-xs">apps/api</code>.
                </>
              )
            }
          />
        )}
      </dl>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Optional features</h3>
        <ul className="flex flex-wrap gap-2" aria-label="Optional features">
          {systemFeatures.map(({ key, label }) => {
            const on = status.features[key];
            return (
              <li
                key={key}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                  on ? "border-success/30 bg-success/8 text-foreground" : "text-muted-foreground",
                )}
              >
                {on ? (
                  <CircleCheck className="size-3.5 text-success" aria-hidden="true" />
                ) : (
                  <CircleDashed className="size-3.5" aria-hidden="true" />
                )}
                {label}
                <span className="sr-only">{on ? ": configured" : ": not configured"}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-pretty text-muted-foreground">
          Set in the server’s <code className="font-mono">.env</code>. Each person still turns most
          of them on in their own settings.
        </p>
      </div>
    </div>
  );
}

function HealthRow({
  label,
  ok,
  value,
  detail,
}: {
  label: string;
  ok: boolean;
  value: string;
  detail?: ReactNode;
}) {
  const Icon = ok ? CircleCheck : CircleAlert;
  return (
    <div className="grid gap-x-4 gap-y-0.5 px-3.5 py-3 @md/panel:grid-cols-[10rem_1fr]">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon
          className={cn("size-4 shrink-0", ok ? "text-success" : "text-warning")}
          aria-hidden="true"
        />
        {label}
      </dt>
      <dd className="min-w-0 space-y-0.5 pl-6 @md/panel:pl-0">
        <p className="text-sm font-medium">
          {value}
          {ok ? null : <span className="sr-only"> (needs attention)</span>}
        </p>
        {detail ? <p className="text-xs text-pretty text-muted-foreground">{detail}</p> : null}
      </dd>
    </div>
  );
}
