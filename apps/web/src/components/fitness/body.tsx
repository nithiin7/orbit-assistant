"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Measurement, ProgressPhoto } from "@orbit/contracts";
import {
  Camera,
  Columns2,
  Gauge,
  History as HistoryIcon,
  Minus,
  MoreHorizontal,
  MoveVertical,
  Pencil,
  Percent,
  Plus,
  Ruler,
  Scale,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { deleteMeasurement, deletePhoto, saveMeasurement, uploadPhoto } from "@/api/fitness";
import { useConfirm } from "@/components/confirm-dialog";
import { DialogShell } from "@/components/dialog-shell";
import { EmptyState } from "@/components/empty-state";
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
  type MeasurementTrend,
  measurementTrend,
  newMeasurementValues,
  toMeasurementFormValues,
  toMeasurementRequest,
  type Units,
} from "@/lib/fitness";

import { LineChart, Loaded, PhotoImage, Section, shortDate } from "./shared";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

/** How many history entries show before "Show all". */
const HISTORY_PREVIEW = 8;

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
          const weight = measurementTrend(list, "weight_g");
          const bodyFat = measurementTrend(list, "body_fat_pct");
          const height = measurementTrend(list, "height_mm");
          const weights = list.flatMap((m) =>
            m.weight_g === null ? [] : [{ day: m.day, grams: m.weight_g }],
          );
          return (
            <div className="space-y-4">
              <WeightCard trend={weight} weights={weights} units={units} />
              <StatGrid hero icon={Scale}>
                <StatTile
                  label="BMI"
                  icon={Gauge}
                  accent="brand"
                  value={bmi ? formatNumber(bmi.value, 1) : "—"}
                >
                  {bmi
                    ? `From ${formatWeight(bmi.weight_g, units.weight_unit)} and ${formatLength(bmi.height_mm, units.length_unit)}`
                    : "Needs a weight and a height (in Settings or a measurement)."}
                </StatTile>
                <StatTile
                  label="Body fat"
                  icon={Percent}
                  accent="neutral"
                  value={bodyFat ? `${formatNumber(bodyFat.value, 1)}%` : "—"}
                >
                  {bodyFat
                    ? changeLine(bodyFat, (v) => `${formatNumber(v, 1)} pts`)
                    : "Only if you measure it."}
                </StatTile>
                <StatTile
                  label="Height"
                  icon={MoveVertical}
                  accent="neutral"
                  value={
                    height
                      ? formatLength(height.value, units.length_unit)
                      : bmi
                        ? formatLength(bmi.height_mm, units.length_unit)
                        : "—"
                  }
                >
                  {height ? `Measured ${shortDate(height.day)}` : bmi ? "From Settings" : "Not set"}
                </StatTile>
              </StatGrid>
              {bmi ? <p className="text-xs text-muted-foreground">{BMI_NOTE}</p> : null}
              <Circumferences list={list} units={units} />
              <History
                list={list}
                units={units}
                onEdit={setEditing}
                onDelete={(m) => void remove(m)}
              />
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

/** A signed difference, such as "+1.2 kg" or "−0.5 kg"; `null` when nothing changed. */
function signedChange(change: number, format: (value: number) => string): string | null {
  if (change === 0) return null;
  return `${change > 0 ? "+" : "−"}${format(Math.abs(change))}`;
}

/** "+1.2 kg since 3 Jan", or when the value was recorded, for a tile's supporting line. */
function changeLine(trend: MeasurementTrend, format: (value: number) => string): string {
  if (!trend.previous) return `Recorded ${shortDate(trend.day)}`;
  const change = signedChange(trend.value - trend.previous.value, format);
  return change
    ? `${change} since ${shortDate(trend.previous.day)}`
    : `No change since ${shortDate(trend.previous.day)}`;
}

/** A change shown as a pill with its direction. Up or down is neither good nor bad here. */
function ChangePill({ label, change }: { label: string; change: string | null }) {
  const Icon = change === null ? Minus : change.startsWith("+") ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs">
      <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
      <span className="font-medium tabular-nums">{change ?? "No change"}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/** The headline: the latest weight, how it moved, and its trend. */
function WeightCard({
  trend,
  weights,
  units,
}: {
  trend: MeasurementTrend | null;
  weights: readonly { day: string; grams: number }[];
  units: Units;
}) {
  const format = (grams: number) => formatWeight(grams, units.weight_unit);
  return (
    <section
      aria-label="Weight"
      className="grid gap-4 rounded-2xl border bg-card p-5 @3xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] @3xl:items-center"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-subtle text-brand">
            <Scale aria-hidden="true" className="size-4" />
          </span>
          Weight
        </div>
        {trend ? (
          <>
            <div>
              <p className="text-3xl font-semibold tracking-tight tabular-nums">
                {format(trend.value)}
              </p>
              <p className="text-xs text-muted-foreground">Recorded {shortDate(trend.day)}</p>
            </div>
            {trend.previous ? (
              <div className="flex flex-wrap gap-2">
                <ChangePill
                  label="since last"
                  change={signedChange(trend.value - trend.previous.value, format)}
                />
                {trend.first && trend.first.day !== trend.previous.day ? (
                  <ChangePill
                    label={`since ${shortDate(trend.first.day)}`}
                    change={signedChange(trend.value - trend.first.value, format)}
                  />
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No weight recorded yet.</p>
        )}
      </div>
      {weights.length > 1 ? (
        <LineChart
          title="Weight over time"
          points={weights.map((w) => ({
            label: shortDate(w.day),
            value: gramsTo(w.grams, units.weight_unit),
          }))}
          format={(v) => `${formatNumber(v, 1)} ${units.weight_unit}`}
        />
      ) : (
        <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
          Record your weight again on another day to see its trend.
        </p>
      )}
    </section>
  );
}

/** The latest of each circumference, with its change since the entry before. */
function Circumferences({ list, units }: { list: readonly Measurement[]; units: Units }) {
  const format = (mm: number) => formatLength(mm, units.length_unit);
  const tiles = MEASUREMENT_FIELDS.flatMap((field) => {
    const trend = measurementTrend(list, `${field}_mm`);
    return trend ? [{ field, trend }] : [];
  });
  return (
    <Section
      icon={Ruler}
      tone="violet"
      title="Measurements"
      description="The latest of each, with the change since you last measured it."
    >
      {tiles.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Add waist, chest, hips, arm, thigh, or neck when you record measurements to track them
          here.
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-2 @2xl:grid-cols-3 @4xl:grid-cols-6">
          {tiles.map(({ field, trend }) => {
            const change = trend.previous
              ? signedChange(trend.value - trend.previous.value, format)
              : null;
            return (
              <div key={field} className="rounded-xl bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">{CIRCUMFERENCE_LABELS[field]}</dt>
                <dd className="text-lg font-semibold tabular-nums">{format(trend.value)}</dd>
                <dd className="text-xs text-muted-foreground tabular-nums">
                  {trend.previous ? (change ?? "No change") : shortDate(trend.day)}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </Section>
  );
}

/** Each entry newest first, its values as chips. */
function History({
  list,
  units,
  onEdit,
  onDelete,
}: {
  list: readonly Measurement[];
  units: Units;
  onEdit: (measurement: Measurement) => void;
  onDelete: (measurement: Measurement) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const newest = [...list].reverse();
  const shown = showAll ? newest : newest.slice(0, HISTORY_PREVIEW);
  return (
    <Section
      icon={HistoryIcon}
      tone="slate"
      title="History"
      description={`${list.length} ${list.length === 1 ? "entry" : "entries"}`}
    >
      <ul className="divide-y">
        {shown.map((m) => (
          <li key={m.id} className="flex items-start gap-3 py-2.5">
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-sm font-medium">{shortDate(m.day)}</p>
              <ul className="flex flex-wrap gap-1.5" aria-label={`Values on ${shortDate(m.day)}`}>
                {values(m, units).map((value) => (
                  <li
                    key={value.label}
                    className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums"
                  >
                    <span className="text-muted-foreground">{value.label}</span> {value.text}
                  </li>
                ))}
              </ul>
              {m.note ? <p className="text-xs text-muted-foreground italic">{m.note}</p> : null}
            </div>
            <Menu
              variant="ghost"
              size="icon"
              chevron={false}
              align="end"
              aria-label={`Actions for ${shortDate(m.day)}`}
              items={[
                { id: "edit", label: "Correct", icon: Pencil, onSelect: () => onEdit(m) },
                {
                  id: "delete",
                  label: "Delete",
                  icon: Trash2,
                  destructive: true,
                  onSelect: () => onDelete(m),
                },
              ]}
            >
              <MoreHorizontal aria-hidden="true" />
            </Menu>
          </li>
        ))}
      </ul>
      {newest.length > HISTORY_PREVIEW ? (
        <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show all ${newest.length}`}
        </Button>
      ) : null}
    </Section>
  );
}

/** An entry's recorded values, labelled, in the person's units. */
function values(m: Measurement, units: Units): { label: string; text: string }[] {
  const parts = [
    m.weight_g !== null
      ? { label: "Weight", text: formatWeight(m.weight_g, units.weight_unit) }
      : null,
    m.body_fat_pct !== null
      ? { label: "Body fat", text: `${formatNumber(m.body_fat_pct, 1)}%` }
      : null,
    m.height_mm !== null
      ? { label: "Height", text: formatLength(m.height_mm, units.length_unit) }
      : null,
    ...MEASUREMENT_FIELDS.map((field) => {
      const value = m[`${field}_mm`];
      return value !== null
        ? { label: CIRCUMFERENCE_LABELS[field], text: formatLength(value, units.length_unit) }
        : null;
    }),
  ];
  return parts.filter((part) => part !== null);
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
      icon={Camera}
      tone="rose"
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
                <li key={photo.id} className="space-y-1.5">
                  <div className="relative overflow-hidden rounded-xl border bg-muted/30">
                    <PhotoImage
                      workspaceId={workspaceId}
                      photoId={photo.id}
                      alt={`Progress photo, ${shortDate(photo.day)}`}
                    />
                    <span className="absolute bottom-2 left-2 rounded-full bg-background/85 px-2 py-0.5 text-xs font-medium shadow-elevation-1 backdrop-blur">
                      {shortDate(photo.day)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-1.5 right-1.5 size-7 bg-background/85 shadow-elevation-1 backdrop-blur hover:bg-background"
                      aria-label={`Delete photo from ${shortDate(photo.day)}`}
                      onClick={() => void remove(photo)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  {photo.note ? (
                    <p className="truncate text-xs text-muted-foreground">{photo.note}</p>
                  ) : null}
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
