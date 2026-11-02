"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Measurement, ProgressPhoto } from "@orbit/contracts";
import { Camera, Columns2, MoreHorizontal, Pencil, Plus, Ruler, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { deleteMeasurement, deletePhoto, saveMeasurement, uploadPhoto } from "@/api/fitness";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { DialogShell } from "@/components/finance/dialog-shell";
import { StatGrid, StatTile } from "@/components/finance/stat-tile";
import { DateField, FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { useFitnessAction, useMeasurements, usePhotos, useUnits } from "@/hooks/use-fitness";
import {
  BMI_NOTE,
  CIRCUMFERENCE_LABELS,
  formatLength,
  formatNumber,
  formatWeight,
  gramsTo,
  MEASUREMENT_FIELDS,
  type MeasurementFormValues,
  measurementSchema,
  newMeasurementValues,
  toMeasurementFormValues,
  toMeasurementRequest,
  type Units,
} from "@/lib/fitness";

import { LineChart, Loaded, PhotoImage, Section, shortDate } from "./shared";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

export function BodyView({ workspaceId, today }: { workspaceId: string; today: string }) {
  const units = useUnits(workspaceId);
  const measurements = useMeasurements(workspaceId);
  const run = useFitnessAction(workspaceId);
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<Measurement | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(measurement: Measurement) {
    const ok = await confirm({
      title: `Delete the entry for ${shortDate(measurement.day)}?`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    run((token) => deleteMeasurement(token, workspaceId, measurement.id)).catch((reason: unknown) =>
      setError(describeApiError(reason, "Couldn’t delete it.")),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" />
          Record measurements
        </Button>
      </div>
      <FormAlert message={error} />
      <Loaded resource={measurements.state} reload={measurements.reload}>
        {({ measurements: list, bmi }) => {
          if (list.length === 0) {
            return (
              <EmptyState
                icon={Ruler}
                title="No measurements yet"
                description="Record your weight or any body measurement. Each entry is kept, so you can see how things change."
              />
            );
          }
          const weights = list.filter((m) => m.weight_g !== null);
          const latest = weights[weights.length - 1];
          const first = weights[0];
          return (
            <div className="space-y-4">
              <StatGrid>
                <StatTile
                  label="Latest weight"
                  value={latest ? formatWeight(latest.weight_g, units.weight_unit) : "—"}
                >
                  {latest ? shortDate(latest.day) : "No weight recorded yet"}
                </StatTile>
                {latest && first && latest !== first && latest.weight_g && first.weight_g ? (
                  <StatTile
                    label="Change"
                    value={`${latest.weight_g > first.weight_g ? "+" : ""}${formatWeight(latest.weight_g - first.weight_g, units.weight_unit)}`}
                  >
                    Since {shortDate(first.day)}
                  </StatTile>
                ) : null}
                <StatTile label="BMI" value={bmi ? formatNumber(bmi.value, 1) : "—"}>
                  {bmi ? BMI_NOTE : "Needs a weight and a height (in Settings or a measurement)."}
                </StatTile>
              </StatGrid>
              {weights.length > 1 ? (
                <Section title="Weight trend">
                  <LineChart
                    title="Weight over time"
                    points={weights.map((m) => ({
                      label: shortDate(m.day),
                      value: gramsTo(m.weight_g ?? 0, units.weight_unit),
                    }))}
                    format={(v) => `${formatNumber(v, 1)} ${units.weight_unit}`}
                  />
                </Section>
              ) : null}
              <Section title="History">
                <ul className="divide-y">
                  {[...list].reverse().map((m) => (
                    <li key={m.id} className="flex items-start justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{shortDate(m.day)}</p>
                        <p className="text-xs text-muted-foreground">{summarize(m, units)}</p>
                        {m.note ? <p className="text-xs">{m.note}</p> : null}
                      </div>
                      <Menu
                        variant="ghost"
                        size="icon"
                        chevron={false}
                        align="end"
                        aria-label={`Actions for ${shortDate(m.day)}`}
                        items={[
                          {
                            id: "edit",
                            label: "Correct",
                            icon: Pencil,
                            onSelect: () => setEditing(m),
                          },
                          {
                            id: "delete",
                            label: "Delete",
                            icon: Trash2,
                            destructive: true,
                            onSelect: () => void remove(m),
                          },
                        ]}
                      >
                        <MoreHorizontal aria-hidden="true" />
                      </Menu>
                    </li>
                  ))}
                </ul>
              </Section>
            </div>
          );
        }}
      </Loaded>
      <PhotosSection workspaceId={workspaceId} today={today} />
      {editing ? (
        <MeasurementDialog
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

function summarize(m: Measurement, units: Units): string {
  const parts = [
    m.weight_g !== null ? formatWeight(m.weight_g, units.weight_unit) : null,
    m.body_fat_pct !== null ? `${formatNumber(m.body_fat_pct, 1)}% body fat` : null,
    m.height_mm !== null ? `height ${formatLength(m.height_mm, units.length_unit)}` : null,
    ...MEASUREMENT_FIELDS.map((field) => {
      const value = m[`${field}_mm`];
      return value !== null
        ? `${CIRCUMFERENCE_LABELS[field].toLowerCase()} ${formatLength(value, units.length_unit)}`
        : null;
    }),
  ];
  return parts.filter(Boolean).join(" · ");
}

export function MeasurementDialog({
  workspaceId,
  editing,
  today,
  units,
  onClose,
}: {
  workspaceId: string;
  editing: Measurement | null;
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
  } = useForm<MeasurementFormValues>({
    resolver: yupResolver(measurementSchema),
    defaultValues: editing ? toMeasurementFormValues(editing, units) : newMeasurementValues(today),
  });

  async function save(values: MeasurementFormValues, close: () => void) {
    try {
      await run((token) =>
        saveMeasurement(
          token,
          workspaceId,
          editing?.id ?? null,
          toMeasurementRequest(values, units),
        ),
      );
      close();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save it.") });
    }
  }

  const length = units.length_unit;
  return (
    <DialogShell
      title={editing ? "Correct measurements" : "Record measurements"}
      description="Fill in only what you measured."
      busy={isSubmitting}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel="Save"
      wide
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <DateField control={control} name="day" label="Date" />
        <FormField
          label={`Weight (${units.weight_unit})`}
          inputMode="decimal"
          autoFocus
          {...register("weight")}
          error={errors.weight?.message}
        />
        <FormField
          label="Body fat (%)"
          inputMode="decimal"
          hint="Only if you measured it."
          {...register("bodyFat")}
          error={errors.bodyFat?.message}
        />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <FormField
          label={`Height (${length})`}
          inputMode="decimal"
          {...register("height")}
          error={errors.height?.message}
        />
        {MEASUREMENT_FIELDS.map((field) => (
          <FormField
            key={field}
            label={`${CIRCUMFERENCE_LABELS[field]} (${length})`}
            inputMode="decimal"
            {...register(field)}
            error={errors[field]?.message}
          />
        ))}
      </div>
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

function PhotosSection({ workspaceId, today }: { workspaceId: string; today: string }) {
  const id = useId();
  const photos = usePhotos(workspaceId);
  const run = useFitnessAction(workspaceId);
  const { confirm, confirmDialog } = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [day, setDay] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);

  async function upload(file: File) {
    setError(null);
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!PHOTO_EXTENSIONS.includes(extension)) {
      setError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError("Photos must be at most 10 MB.");
      return;
    }
    setBusy(true);
    try {
      await run((token) => uploadPhoto(token, workspaceId, file, day, note.trim()));
      setNote("");
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t upload the photo."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(photo: ProgressPhoto) {
    const ok = await confirm({
      title: "Delete this photo?",
      description: "The image is deleted from Orbit. This can’t be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    run((token) => deletePhoto(token, workspaceId, photo.id)).catch((reason: unknown) =>
      setError(describeApiError(reason, "Couldn’t delete the photo.")),
    );
  }

  return (
    <Section
      title="Progress photos"
      description="Private to you. Stored on Orbit’s server with your files, never at a public link."
      action={
        photos.state.status === "success" && photos.state.data.photos.length > 1 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setComparing(!comparing)}
            aria-pressed={comparing}
          >
            <Columns2 aria-hidden="true" />
            Compare
          </Button>
        ) : null
      }
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-day`} className="block text-xs font-medium">
            Date
          </label>
          <DatePicker id={`${id}-day`} value={day} onValueChange={setDay} className="w-40" />
        </div>
        <div className="min-w-40 flex-1 space-y-1">
          <label htmlFor={`${id}-note`} className="block text-xs font-medium">
            Note (optional)
          </label>
          <Input id={`${id}-note`} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        <input
          ref={input}
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          className="sr-only"
          aria-label="Choose a photo"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button variant="soft" disabled={busy} onClick={() => input.current?.click()}>
          <Camera aria-hidden="true" />
          {busy ? "Uploading…" : "Add photo"}
        </Button>
      </div>
      <FormAlert message={error} />
      <Loaded resource={photos.state} reload={photos.reload} skeleton="h-32">
        {({ photos: list }) =>
          list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No photos yet.</p>
          ) : comparing ? (
            <PhotoCompare workspaceId={workspaceId} photos={list} />
          ) : (
            <ul className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
              {list.map((photo) => (
                <li key={photo.id} className="space-y-1">
                  <div className="overflow-hidden rounded-lg border bg-muted/30">
                    <PhotoImage
                      workspaceId={workspaceId}
                      photoId={photo.id}
                      alt={`Progress photo, ${shortDate(photo.day)}`}
                    />
                  </div>
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{shortDate(photo.day)}</p>
                      {photo.note ? (
                        <p className="truncate text-xs text-muted-foreground">{photo.note}</p>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Delete photo from ${shortDate(photo.day)}`}
                      onClick={() => void remove(photo)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      {confirmDialog}
    </Section>
  );
}

/** Two photos side by side, each chosen by date. */
function PhotoCompare({
  workspaceId,
  photos,
}: {
  workspaceId: string;
  photos: readonly ProgressPhoto[];
}) {
  const options = photos.map((p) => ({
    value: p.id,
    label: `${shortDate(p.day)}${p.note ? ` · ${p.note}` : ""}`,
  }));
  const [before, setBefore] = useState(photos[photos.length - 1]?.id ?? "");
  const [after, setAfter] = useState(photos[0]?.id ?? "");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(
        [
          ["Before", before, setBefore],
          ["After", after, setAfter],
        ] as const
      ).map(([label, value, set]) => (
        <div key={label} className="space-y-2">
          <Select
            aria-label={`${label} photo`}
            value={value}
            onValueChange={set}
            options={options}
          />
          {value ? (
            <div className="overflow-hidden rounded-lg border bg-muted/30">
              <PhotoImage workspaceId={workspaceId} photoId={value} alt={`${label} photo`} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
