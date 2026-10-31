"use client";

import type { Currency } from "@orbit/contracts";
import { type ComponentProps, type ReactNode, useId } from "react";
import { type Control, type FieldPath, type FieldValues, useController } from "react-hook-form";

import { AmountInput } from "@/components/ui/amount-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select, type SelectItems } from "@/components/ui/select";

type FieldShellProps = {
  label: string;
  /** Persistent guidance, such as a password requirement. */
  hint?: string;
  error?: string;
  /** A small control beside the label, such as a "Forgot password?" link. */
  labelAction?: ReactNode;
  /** Renders the control, given the attributes that tie it to the label, hint, and error. */
  children: (control: {
    id: string;
    "aria-invalid"?: true;
    "aria-describedby"?: string;
  }) => ReactNode;
};

/** A label, a control, and its hint and error, announced with it via `aria-describedby`. */
function FieldShell({ label, hint, error, labelAction, children }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        {labelAction}
      </div>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy || undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type FormFieldProps = Omit<ComponentProps<"input">, "id"> & Omit<FieldShellProps, "children">;

/** A labelled input whose hint and error are announced with it via `aria-describedby`. */
export function FormField({ label, hint, error, labelAction, ...inputProps }: FormFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} labelAction={labelAction}>
      {(control) => <Input {...control} {...inputProps} />}
    </FieldShell>
  );
}

/**
 * A field bound to a React Hook Form `control`. The form owns the value, so `reset` and
 * `setValue` show at once; the field's own validation error is shown under it.
 */
type ControlledFieldProps<F extends FieldValues, N extends FieldPath<F>, T> = {
  control: Control<F, unknown, T>;
  name: N;
  label: string;
  hint?: string;
  labelAction?: ReactNode;
  disabled?: boolean;
};

/** A labelled `Select` bound to a form field. `onValueChange` runs after the form updates. */
export function SelectField<F extends FieldValues, N extends FieldPath<F>, T = F>({
  control,
  name,
  label,
  hint,
  labelAction,
  disabled,
  options,
  placeholder,
  onValueChange,
  error,
}: ControlledFieldProps<F, N, T> & {
  options: SelectItems<string>;
  placeholder?: string;
  onValueChange?: (value: string) => void;
  /** An error the form reports on another field, about this one. */
  error?: string;
}) {
  const { field, fieldState } = useController({ control, name, disabled });
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error ?? fieldState.error?.message}
      labelAction={labelAction}
    >
      {(props) => (
        <Select
          {...props}
          ref={field.ref}
          value={String(field.value ?? "")}
          onValueChange={(value) => {
            field.onChange(value);
            onValueChange?.(value);
          }}
          onBlur={field.onBlur}
          disabled={field.disabled}
          options={options}
          placeholder={placeholder}
        />
      )}
    </FieldShell>
  );
}

/** A labelled `DatePicker` bound to a `YYYY-MM-DD` form field. */
export function DateField<F extends FieldValues, N extends FieldPath<F>, T = F>({
  control,
  name,
  label,
  hint,
  labelAction,
  disabled,
  clearable,
  placeholder,
}: ControlledFieldProps<F, N, T> & { clearable?: boolean; placeholder?: string }) {
  const { field, fieldState } = useController({ control, name, disabled });
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={fieldState.error?.message}
      labelAction={labelAction}
    >
      {(props) => (
        <DatePicker
          {...props}
          ref={field.ref}
          value={String(field.value ?? "")}
          onValueChange={field.onChange}
          onBlur={field.onBlur}
          disabled={field.disabled}
          clearable={clearable}
          placeholder={placeholder}
        />
      )}
    </FieldShell>
  );
}

/** A labelled `AmountInput` bound to a form field, grouping digits the `currency`'s way. */
export function AmountField<F extends FieldValues, N extends FieldPath<F>, T = F>({
  control,
  name,
  label,
  hint,
  labelAction,
  disabled,
  currency,
  placeholder,
  autoFocus,
}: ControlledFieldProps<F, N, T> & {
  currency: Currency;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { field, fieldState } = useController({ control, name, disabled });
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={fieldState.error?.message}
      labelAction={labelAction}
    >
      {(props) => (
        <AmountInput
          {...props}
          ref={field.ref}
          name={field.name}
          value={String(field.value ?? "")}
          onValueChange={field.onChange}
          onBlur={field.onBlur}
          disabled={field.disabled}
          currency={currency}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
      )}
    </FieldShell>
  );
}

/** A form-level error, announced when it appears. */
export function FormAlert({ message }: { message: string | null }) {
  return (
    <div role="alert" aria-live="assertive">
      {message ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {message}
        </p>
      ) : null}
    </div>
  );
}
