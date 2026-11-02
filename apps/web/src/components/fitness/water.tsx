"use client";

import { Droplets, X } from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { addWater, deleteWater } from "@/api/fitness";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  useFitnessAction,
  useFitnessProfile,
  useWaterDay,
  useWaterHistory,
} from "@/hooks/use-fitness";
import { formatWater, parseWater, share, WATER_LABELS } from "@/lib/fitness";
import { addDays } from "@/utils/dates";

import { DayNavigator } from "./nutrition";
import { BarChart, Loaded, Meter, NumberInput, Section } from "./shared";

const DEFAULT_QUICK = [250, 500, 750];

export function WaterView({ workspaceId, today }: { workspaceId: string; today: string }) {
  const profile = useFitnessProfile(workspaceId);
  const unit = profile.state.status === "success" ? profile.state.data.water_unit : "ml";
  const quick =
    profile.state.status === "success" && profile.state.data.water_quick_amounts_ml.length > 0
      ? profile.state.data.water_quick_amounts_ml
      : DEFAULT_QUICK;
  const [day, setDay] = useState(today);
  const water = useWaterDay(workspaceId, day);
  const run = useFitnessAction(workspaceId);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = (ml: number) => {
    setError(null);
    run((token) => addWater(token, workspaceId, day, ml), { touches: ["habits"] }).catch(
      (reason: unknown) => setError(describeApiError(reason, "Couldn’t add the water.")),
    );
  };
  const customMl = parseWater(custom, unit);

  return (
    <div className="space-y-4">
      <DayNavigator day={day} today={today} onChange={setDay} />
      <Loaded resource={water.state} reload={water.reload} skeleton="h-48">
        {(data) => (
          <div className="grid gap-4 @3xl:grid-cols-2">
            <Section title="Water" description="Only what you record as water counts here.">
              <p className="text-3xl font-semibold tabular-nums">
                {formatWater(data.total_ml, unit)}
              </p>
              <Meter
                label={data.target_ml ? "Daily target" : "No target set"}
                value={
                  data.target_ml
                    ? `${formatWater(data.total_ml, unit)} of ${formatWater(data.target_ml, unit)}`
                    : "Set one in Settings"
                }
                fraction={share(data.total_ml, data.target_ml)}
                tone={data.target_ml && data.total_ml >= data.target_ml ? "success" : "brand"}
              />
              <div className="flex flex-wrap gap-2" role="group" aria-label="Quick add">
                {quick.map((ml) => (
                  <Button key={ml} variant="soft" onClick={() => add(ml)}>
                    <Droplets aria-hidden="true" />+{formatWater(ml, unit)}
                  </Button>
                ))}
              </div>
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (customMl && customMl > 0 && customMl <= 10_000) {
                    add(customMl);
                    setCustom("");
                  } else {
                    setError(`Enter an amount up to ${formatWater(10_000, unit)}.`);
                  }
                }}
              >
                <NumberInput
                  label="Another amount"
                  unit={WATER_LABELS[unit]}
                  value={custom}
                  onChange={setCustom}
                  className="w-40"
                />
                <Button type="submit" variant="outline">
                  Add
                </Button>
              </form>
              <FormAlert message={error} />
            </Section>
            <Section title="Entries">
              {data.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing recorded for this day.</p>
              ) : (
                <ul className="divide-y">
                  {data.entries.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between py-1.5 text-sm">
                      <span>
                        {formatWater(entry.amount_ml, unit)}{" "}
                        <span className="text-xs text-muted-foreground">
                          at{" "}
                          {new Date(entry.created_at).toLocaleTimeString([], {
                            timeStyle: "short",
                          })}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Remove ${formatWater(entry.amount_ml, unit)}`}
                        onClick={() =>
                          run((token) => deleteWater(token, workspaceId, entry.id)).catch(
                            (reason: unknown) =>
                              setError(describeApiError(reason, "Couldn’t remove it.")),
                          )
                        }
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        )}
      </Loaded>
      <WaterHistory workspaceId={workspaceId} today={today} unit={unit} />
    </div>
  );
}

function WaterHistory({
  workspaceId,
  today,
  unit,
}: {
  workspaceId: string;
  today: string;
  unit: "ml" | "l" | "fl_oz";
}) {
  const start = addDays(today, -13);
  const history = useWaterHistory(workspaceId, start, today);
  return (
    <Section title="Last 14 days">
      <Loaded resource={history.state} reload={history.reload} skeleton="h-32">
        {({ days }) => {
          const byDay = new Map(days.map((d) => [d.day, d.total_ml]));
          return (
            <BarChart
              title="Water per day"
              bars={Array.from({ length: 14 }, (_, i) => {
                const date = addDays(start, i);
                return { label: date.slice(8), value: byDay.get(date) ?? 0 };
              })}
              format={(ml) => formatWater(ml, unit)}
            />
          );
        }}
      </Loaded>
    </Section>
  );
}
