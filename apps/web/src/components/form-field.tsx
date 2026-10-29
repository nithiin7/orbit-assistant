import { type ComponentProps, type ReactNode, useId } from "react";

import { Input } from "@/components/ui/input";

type FormFieldProps = Omit<ComponentProps<"input">, "id"> & {
  label: string;
  /** Persistent guidance, such as a password requirement. */
  hint?: string;
  error?: string;
  /** A small control beside the label, such as a "Forgot password?" link. */
  labelAction?: ReactNode;
};

/** A labelled input whose hint and error are announced with it via `aria-describedby`. */
export function FormField({ label, hint, error, labelAction, ...inputProps }: FormFieldProps) {
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
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...inputProps}
      />
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

/** Focus the first field with an error. `fields` maps error keys to input names, in form order. */
export function focusFirstInvalid(
  form: HTMLFormElement | null,
  errors: Record<string, string | undefined>,
  fields: Record<string, string>,
) {
  const name = Object.entries(fields).find(([key]) => errors[key])?.[1];
  if (name) form?.querySelector<HTMLInputElement>(`[name="${name}"]`)?.focus();
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
