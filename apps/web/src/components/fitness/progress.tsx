"use client";

import type { PersonalRecord } from "@orbit/contracts";
import { Trophy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { StatGrid, StatTile } from "@/components/finance/stat-tile";
import { Select } from "@/components/ui/select";
import { useRecords, useUnits, useWorkoutAnalytics } from "@/hooks/use-fitness";
import {
  ESTIMATE_NOTE,
  fitnessHref,
  formatDuration,
  formatPercent,
  formatRecord,
  formatVolume,
  gramsTo,
  muscleLabel,
  RECORD_LABELS,
  type Units,
} from "@/lib/fitness";
import { addDays } from "@/utils/dates";

import { BarChart, Loaded, Section, shortDate } from "./shared";

const RANGES = [
  { value: "28", label: "Last 4 weeks" },
  { value: "84", label: "Last 12 weeks" },
  { value: "182", label: "Last 6 months" },
  { value: "365", label: "Last year" },
] as const;

type Range = (typeof RANGES)[number]["value"];

export function ProgressView({ workspaceId, today }: { workspaceId: string; today: string }) {
  const units = useUnits(workspaceId);
  const [range, setRange] = useState<Range>("84");
  const start = addDays(today, -(Number(range) - 1));
  const analytics = useWorkoutAnalytics(workspaceId, { start, end: today, date: today });
  const records = useRecords(workspaceId);

  return (
    <div className="space-y-4">
      <Select
        aria-label="Range"
        className="w-48"
        value={range}
        onValueChange={setRange}
        options={RANGES}
      />
      <Loaded resource={analytics.state} reload={analytics.reload} skeleton="h-64">
        {(data) => {
          const muscles = Object.entries(data.muscle_sets);
          const totalSets = muscles.reduce((sum, [, sets]) => sum + sets, 0);
          const weekly = data.weekly.length > 16 ? data.monthly : data.weekly;
          return (
            <div className="space-y-4">
              <StatGrid>
                <StatTile label="Workouts" value={data.workouts}>
                  {data.total_weeks > 0
                    ? `${(data.workouts / data.total_weeks).toFixed(1)} a week on average`
                    : ""}
                </StatTile>
                <StatTile label="Time training" value={formatDuration(data.duration_s)}>
                  Completed workouts only
                </StatTile>
                <StatTile label="Volume" value={formatVolume(data.volume_g, units.weight_unit)}>
                  Weight × reps, warm-ups excluded
                </StatTile>
                <StatTile
                  label="Consistency"
                  value={
                    data.total_weeks ? formatPercent(data.active_weeks / data.total_weeks) : "—"
                  }
                >
                  {`${data.active_weeks} of ${data.total_weeks} weeks with a workout · ${data.current_week_streak}-week streak`}
                </StatTile>
              </StatGrid>
              <div className="grid gap-4 @4xl:grid-cols-2">
                <Section
                  title={weekly === data.weekly ? "Workouts per week" : "Workouts per month"}
                >
                  <BarChart
                    title="Workouts per period"
                    bars={weekly.map((p) => ({ label: shortDate(p.start), value: p.workouts }))}
                    format={(n) => `${n} workouts`}
                  />
                </Section>
                <Section title="Training volume">
                  <BarChart
                    title="Volume per period"
                    bars={weekly.map((p) => ({
                      label: shortDate(p.start),
                      value: Math.round(gramsTo(p.volume_g, units.weight_unit)),
                    }))}
                    format={(v) => `${v} ${units.weight_unit}`}
                  />
                </Section>
              </div>
              <Section
                title="Muscle groups"
                description="Completed working sets by primary muscle."
              >
                {muscles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sets in this range.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {muscles.map(([muscle, sets]) => (
                      <li
                        key={muscle}
                        className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 text-sm"
                      >
                        <span className="truncate">{muscleLabel(muscle)}</span>
                        <div
                          className="h-2 overflow-hidden rounded-full bg-muted"
                          aria-hidden="true"
                        >
                          <div
                            className="h-full rounded-full bg-chart-1"
                            style={{ width: `${(sets / Math.max(1, totalSets)) * 100}%` }}
                          />
                        </div>
                        <span className="text-right text-xs text-muted-foreground tabular-nums">
                          {sets}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          );
        }}
      </Loaded>
      <Section title="Personal records" description={ESTIMATE_NOTE}>
        <Loaded resource={records.state} reload={records.reload} skeleton="h-32">
          {({ records: list }) => <RecordTable records={list} units={units} />}
        </Loaded>
      </Section>
    </div>
  );
}

export function RecordTable({
  records,
  units,
}: {
  records: readonly PersonalRecord[];
  units: Units;
}) {
  if (records.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Trophy aria-hidden="true" className="size-4" />
        Complete a workout to set your first records.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="pb-1 font-medium">
              Exercise
            </th>
            <th scope="col" className="pb-1 font-medium">
              Record
            </th>
            <th scope="col" className="pb-1 font-medium">
              Best
            </th>
            <th scope="col" className="pb-1 font-medium">
              Set on
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {records.map((record) => (
            <tr key={`${record.exercise_id}-${record.kind}`}>
              <td className="py-1.5 pr-2">
                <Link
                  href={fitnessHref({ kind: "exercise", id: record.exercise_id })}
                  className="underline-offset-2 hover:underline"
                >
                  {record.exercise_name}
                </Link>
              </td>
              <td className="py-1.5 pr-2 text-muted-foreground">{RECORD_LABELS[record.kind]}</td>
              <td className="py-1.5 pr-2 tabular-nums">{formatRecord(record, units)}</td>
              <td className="py-1.5 text-muted-foreground">{shortDate(record.day)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
