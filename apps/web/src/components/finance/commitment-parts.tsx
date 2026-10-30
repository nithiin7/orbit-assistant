"use client";

import type { CommitmentKind, PaymentStatus } from "@orbit/contracts";
import { Landmark, type LucideIcon, Receipt, Repeat } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";

import { FormField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MAX_REMINDER_DAYS, paymentStatusLabel } from "@/lib/commitments";
import { cn } from "@/utils/common";

const STATUS_TONES: Record<PaymentStatus, string> = {
  overdue: "border-destructive/40 text-destructive",
  due: "border-warning/40 text-warning",
  upcoming: "",
  paid: "border-success/40 text-success",
  skipped: "",
};

/** A payment's status as a badge; overdue and due stand out, the rest stay quiet. */
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge variant="outline" className={STATUS_TONES[status]}>
      {paymentStatusLabel(status)}
    </Badge>
  );
}

const KIND_ICONS: Record<CommitmentKind, LucideIcon> = {
  loan: Landmark,
  subscription: Repeat,
  bill: Receipt,
};

export function KindIcon({ kind, className }: { kind: CommitmentKind; className?: string }) {
  const Icon = KIND_ICONS[kind];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted/60 text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

type FieldProps = Omit<ComponentProps<typeof FormField>, "label">;

/**
 * "Remind me N days before, at HH:MM". Blank days means no reminder. Reminders are delivered in
 * the app (the notification bell) in your time zone, like other reminders.
 */
export function ReminderFields({
  days,
  time,
  daysError,
}: {
  days: FieldProps;
  time: FieldProps;
  daysError?: string;
}) {
  return (
    <fieldset className="space-y-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Reminder</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          label="Days before"
          inputMode="numeric"
          autoComplete="off"
          placeholder="No reminder"
          hint={`0 to ${MAX_REMINDER_DAYS}. Leave blank for none.`}
          error={daysError}
          {...days}
        />
        <FormField label="At" type="time" {...time} />
      </div>
    </fieldset>
  );
}

type ConfirmOption = {
  label: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
};

/**
 * A small button that asks before doing something hard to take back: it turns into the choices
 * and a Cancel, focusing the first choice. Escape cancels and returns focus to the button.
 */
export function ConfirmAction({
  label,
  prompt,
  options,
  disabled = false,
}: {
  label: string;
  /** The question, announced as the group's name. */
  prompt: string;
  options: ConfirmOption[];
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) firstRef.current?.focus();
  }, [confirming]);

  const cancel = () => {
    setConfirming(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
    );
  }
  return (
    <div
      role="group"
      aria-label={prompt}
      className="flex flex-wrap items-center gap-1"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          cancel();
        }
      }}
    >
      {options.map((option, index) => (
        <Button
          key={option.label}
          ref={index === 0 ? firstRef : undefined}
          variant={option.destructive ? "destructive" : "outline"}
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void option.onConfirm().finally(() => {
              setBusy(false);
              setConfirming(false);
            });
          }}
        >
          {option.label}
        </Button>
      ))}
      <Button variant="ghost" size="sm" disabled={busy} onClick={cancel}>
        Cancel
      </Button>
    </div>
  );
}
