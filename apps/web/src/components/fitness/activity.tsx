"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Activity, ActivityKind } from "@orbit/contracts";
import { Footprints, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { deleteActivity, saveActivity } from "@/api/fitness";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { DialogShell } from "@/components/finance/dialog-shell";
import { DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { useActivities, useFitnessAction, useUnits } from "@/hooks/use-fitness";
import {
  ACTIVITY_KINDS,
  activityFields,
  type ActivityFormValues,
  activitySchema,
  describeActivity,
  labelOf,
  newActivityValues,
  toActivityFormValues,
  toActivityRequest,
  type Units,
} from "@/lib/fitness";

import { Loaded, shortDate } from "./shared";

export function ActivityView({ workspaceId, today }: { workspaceId: string; today: string }) {
  const units = useUnits(workspaceId);
  const activities = useActivities(workspaceId);
  const run = useFitnessAction(workspaceId);
  const { confirm, confirmDialog } = useConfirm();
  const [kind, setKind] = useState<ActivityKind | "all">("all");
  const [editing, setEditing] = useState<Activity | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(activity: Activity) {
    const ok = await confirm({
      title: "Delete this entry?",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    run((token) => deleteActivity(token, workspaceId, activity.id)).catch((reason: unknown) =>
      setError(describeApiError(reason, "Couldn’t delete it.")),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" />
          Record activity
        </Button>
        <Select
          aria-label="Show"
          className="w-44"
          value={kind}
          onValueChange={setKind}
          options={[{ value: "all", label: "All activity" }, ...ACTIVITY_KINDS]}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Entered by hand. Orbit doesn’t connect to fitness trackers or estimate activity.
      </p>
      <FormAlert message={error} />
      <Loaded resource={activities.state} reload={activities.reload}>
        {({ activities: list }) => {
          const shown = list.filter((a) => kind === "all" || a.kind === kind);
          if (shown.length === 0) {
            return (
              <EmptyState
                icon={Footprints}
                title="No activity recorded"
                description="Record steps, walks, runs, rides, swims, sleep, or a rest day."
              />
            );
          }
          return (
            <ul className="divide-y rounded-xl border bg-card px-3">
              {shown.map((activity) => (
                <li key={activity.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {labelOf(ACTIVITY_KINDS, activity.kind)}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {shortDate(activity.day)}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {describeActivity(activity, units)}
                      {activity.note ? ` · ${activity.note}` : ""}
                    </p>
                  </div>
                  <Menu
                    variant="ghost"
                    size="icon"
                    chevron={false}
                    align="end"
                    aria-label={`Actions for ${labelOf(ACTIVITY_KINDS, activity.kind)} on ${shortDate(activity.day)}`}
                    items={[
                      {
                        id: "edit",
                        label: "Correct",
                        icon: Pencil,
                        onSelect: () => setEditing(activity),
                      },
                      {
                        id: "delete",
                        label: "Delete",
                        icon: Trash2,
                        destructive: true,
                        onSelect: () => void remove(activity),
                      },
                    ]}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Menu>
                </li>
              ))}
            </ul>
          );
        }}
      </Loaded>
      {editing ? (
        <ActivityDialog
          workspaceId={workspaceId}
          editing={editing === "new" ? null : editing}
          today={today}
          units={units}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

export function ActivityDialog({
  workspaceId,
  editing,
  today,
  units,
  onClose,
}: {
  workspaceId: string;
  editing: Activity | null;
  today: string;
  units: Units;
  onClose: () => void;
}) {
  const run = useFitnessAction(workspaceId);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ActivityFormValues>({
    resolver: yupResolver(activitySchema),
    defaultValues: editing ? toActivityFormValues(editing, units) : newActivityValues(today),
  });
  const kind = useWatch({ control, name: "kind" });
  const fields = activityFields(kind);

  async function save(values: ActivityFormValues, close: () => void) {
    try {
      await run(
        (token) =>
          saveActivity(token, workspaceId, editing?.id ?? null, toActivityRequest(values, units)),
        { touches: ["habits"] },
      );
      close();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save it.") });
    }
  }

  return (
    <DialogShell
      title={editing ? "Correct activity" : "Record activity"}
      busy={isSubmitting}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel="Save"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField control={control} name="day" label="Date" />
        <SelectField control={control} name="kind" label="Activity" options={ACTIVITY_KINDS} />
      </div>
      {fields.steps ? (
        <FormField
          label="Steps"
          inputMode="numeric"
          autoFocus
          {...register("steps")}
          error={errors.steps?.message}
        />
      ) : null}
      {fields.distance || fields.duration ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.distance ? (
            <FormField
              label={`Distance (${units.distance_unit})`}
              inputMode="decimal"
              {...register("distance")}
              error={errors.distance?.message}
            />
          ) : null}
          {fields.duration ? (
            <FormField
              label={kind === "sleep" ? "Hours" : "Minutes"}
              inputMode="decimal"
              {...register("duration")}
              error={errors.duration?.message}
            />
          ) : null}
        </div>
      ) : null}
      <FormField
        label="Note"
        autoComplete="off"
        {...register("note")}
        error={errors.note?.message}
      />
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}
