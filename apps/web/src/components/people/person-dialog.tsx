"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { Cake, Plus, X } from "lucide-react";
import { useId } from "react";
import { type Control, useFieldArray, useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { DialogShell } from "@/components/dialog-shell";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  dayOptions,
  daysInMonth,
  MAX_DATES,
  MONTH_OPTIONS,
  newOtherDate,
  NOTE_MAX_LENGTH,
  personSchema,
  type PersonValues,
  RELATIONSHIP_OPTIONS,
  remindOptions,
} from "@/lib/people";
import { cn } from "@/utils/common";
import { timeZoneLabel } from "@/utils/time-zones";

const KIND_OPTIONS = [
  { value: "anniversary", label: "Anniversary" },
  { value: "other", label: "Something else" },
];

type PersonDialogProps = {
  mode: "add" | "edit";
  initial: PersonValues;
  /** The zone reminders fire in, to say so beside the time. */
  timezone: string;
  onSave: (values: PersonValues) => Promise<void>;
  /** Called once the dialog has closed, whether saved or cancelled. */
  onClose: () => void;
};

/** Adds a person or edits one: who they are, their dates, and how to reach them. */
export function PersonDialog({ mode, initial, timezone, onSave, onClose }: PersonDialogProps) {
  const id = useId();
  const adding = mode === "add";
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors, isSubmitting: saving },
  } = useForm({ resolver: yupResolver(personSchema), defaultValues: initial });
  const others = useFieldArray({ control, name: "others" });
  const [note, birthdayMonth] = useWatch({ control, name: ["note", "birthdayMonth"] });

  async function save(values: PersonValues, close: () => void) {
    try {
      await onSave(values);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save this person. Try again."),
      });
    }
  }

  /** A day the new month doesn't have is cleared rather than left invalid. */
  function keepDay(month: string, dayField: "birthdayDay" | `others.${number}.day`) {
    const day = getValues(dayField);
    if (day && month && Number(day) > daysInMonth(2000, Number(month))) setValue(dayField, "");
  }

  return (
    <DialogShell
      title={adding ? "Add a person" : "Edit person"}
      description={
        adding ? "A name is enough. Add their birthday and Orbit reminds you." : undefined
      }
      busy={saving}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel={adding ? "Add person" : "Save changes"}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <FormField
          label="Name"
          autoComplete="off"
          autoFocus={adding}
          placeholder="Who is it?"
          {...register("name")}
          error={errors.name?.message}
        />
        <SelectField
          control={control}
          name="relationship"
          label="Relationship"
          options={RELATIONSHIP_OPTIONS}
        />
      </div>

      <fieldset className="space-y-3 rounded-xl border bg-muted/30 p-4">
        <legend className="flex items-center gap-2 px-1 text-sm font-medium">
          <Cake className="size-4 text-brand" aria-hidden="true" />
          Birthday
        </legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,1.5fr)]">
          <SelectField
            control={control}
            name="birthdayMonth"
            label="Month"
            placeholder="Month"
            options={[{ value: "", label: "No birthday" }, ...MONTH_OPTIONS]}
            onValueChange={(month) => {
              if (!month) setValue("birthdayDay", "");
              else keepDay(month, "birthdayDay");
            }}
          />
          <SelectField
            control={control}
            name="birthdayDay"
            label="Day"
            placeholder="Day"
            options={dayOptions(birthdayMonth)}
            disabled={!birthdayMonth}
          />
          <FormField
            label="Year"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="Optional"
            disabled={!birthdayMonth}
            {...register("birthdayYear")}
            error={errors.birthdayYear?.message}
          />
          <RemindField control={control} name="birthdayRemind" disabled={!birthdayMonth} />
        </div>
        <p className="text-xs text-muted-foreground">
          Add the year to see how old they’re turning.
        </p>
      </fieldset>

      {others.fields.length > 0 ? (
        <div className="space-y-3">
          {others.fields.map((field, index) => (
            <OtherDateRow
              key={field.id}
              index={index}
              control={control}
              register={register}
              errors={errors.others?.[index]}
              onMonth={(month) => keepDay(month, `others.${index}.day`)}
              onRemove={() => others.remove(index)}
            />
          ))}
        </div>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        disabled={others.fields.length >= MAX_DATES - 1}
        onClick={() => others.append(newOtherDate())}
      >
        <Plus aria-hidden="true" />
        Add an anniversary or other date
      </Button>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Phone"
          type="tel"
          autoComplete="off"
          placeholder="Optional"
          {...register("phone")}
          error={errors.phone?.message}
        />
        <FormField
          label="Email"
          type="email"
          autoComplete="off"
          placeholder="Optional"
          {...register("email")}
          error={errors.email?.message}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${id}-note`} className="block text-sm font-medium">
          Note <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id={`${id}-note`}
          rows={2}
          placeholder="Gift ideas, favourite things, how you met…"
          {...register("note")}
          aria-invalid={errors.note ? true : undefined}
          aria-describedby={`${id}-note-hint`}
        />
        <p
          id={`${id}-note-hint`}
          className={cn(
            "text-xs",
            errors.note ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {errors.note?.message ?? `${note.trim().length} / ${NOTE_MAX_LENGTH} characters`}
        </p>
      </div>

      <div className="grid items-end gap-4 sm:grid-cols-2">
        <FormField
          label="Remind me at"
          type="time"
          hint={`Time zone: ${timeZoneLabel(timezone)}`}
          {...register("reminderTime")}
          error={errors.reminderTime?.message}
        />
        <label className="flex items-center gap-2.5 pb-2 text-sm">
          <Checkbox {...register("favorite")} />
          <span>
            Favorite
            <span className="text-muted-foreground"> — keep them at the top</span>
          </span>
        </label>
      </div>

      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

function RemindField({
  control,
  name,
  disabled = false,
}: {
  control: Control<PersonValues>;
  name: "birthdayRemind" | `others.${number}.remind`;
  disabled?: boolean;
}) {
  const current = useWatch({ control, name });
  return (
    <SelectField
      control={control}
      name={name}
      label="Remind me"
      options={remindOptions(current)}
      disabled={disabled}
    />
  );
}

type OtherErrors = NonNullable<
  ReturnType<typeof useForm<PersonValues>>["formState"]["errors"]["others"]
>[number];

function OtherDateRow({
  index,
  control,
  register,
  errors,
  onMonth,
  onRemove,
}: {
  index: number;
  control: Control<PersonValues>;
  register: ReturnType<typeof useForm<PersonValues>>["register"];
  errors: OtherErrors | undefined;
  onMonth: (month: string) => void;
  onRemove: () => void;
}) {
  const [kind, month] = useWatch({
    control,
    name: [`others.${index}.kind`, `others.${index}.month`],
  });
  return (
    <fieldset className="space-y-3 rounded-xl border p-4">
      <div className="flex items-end gap-3">
        <legend className="sr-only">Date {index + 2}</legend>
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          <SelectField
            control={control}
            name={`others.${index}.kind`}
            label="What"
            options={KIND_OPTIONS}
          />
          {kind === "other" ? (
            <FormField
              label="Name it"
              autoComplete="off"
              placeholder="Name day, adoption day…"
              {...register(`others.${index}.label`)}
              error={errors?.label?.message}
            />
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove date ${index + 2}`}
          onClick={onRemove}
          className="mb-0.5 size-9 shrink-0 text-muted-foreground"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,1.5fr)]">
        <SelectField
          control={control}
          name={`others.${index}.month`}
          label="Month"
          placeholder="Month"
          options={MONTH_OPTIONS}
          onValueChange={onMonth}
        />
        <SelectField
          control={control}
          name={`others.${index}.day`}
          label="Day"
          placeholder="Day"
          options={dayOptions(month)}
        />
        <FormField
          label="Year"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          placeholder="Optional"
          {...register(`others.${index}.year`)}
          error={errors?.year?.message}
        />
        <RemindField control={control} name={`others.${index}.remind`} />
      </div>
    </fieldset>
  );
}
