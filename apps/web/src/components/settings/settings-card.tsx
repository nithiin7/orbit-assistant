"use client";

import { type LucideIcon, ShieldCheck } from "lucide-react";
import { type ReactNode, useId } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/utils/common";

/** The rounded icon at the start of a settings card's header. */
export function IconTile({ icon: Icon, muted = false }: { icon: LucideIcon; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl",
        muted ? "bg-muted text-muted-foreground" : "bg-brand-subtle text-brand",
      )}
    >
      <Icon className="size-4.5" />
    </span>
  );
}

type SettingsCardProps = {
  /** The title's id, which names the card for assistive tech. */
  titleId: string;
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  /** Beside the title, e.g. a status badge or a button. */
  action?: ReactNode;
  /** The card's own id, for links to it. */
  id?: string;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
};

/** A settings card: an icon, a title, one line on what it's for, then its controls. */
export function SettingsCard({
  titleId,
  icon,
  title,
  description,
  action,
  id,
  className,
  headerClassName,
  bodyClassName,
  children,
}: SettingsCardProps) {
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn("rounded-2xl border bg-card shadow-elevation-1", className)}
    >
      <header className={cn("flex items-start gap-3 border-b px-4 py-4 sm:px-5", headerClassName)}>
        <IconTile icon={icon} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">{description}</p>
        </div>
        {action}
      </header>
      <div className={cn("space-y-5 px-4 py-5 sm:px-5", bodyClassName)}>{children}</div>
    </section>
  );
}

type SettingsSwitchProps = {
  label: string;
  /** A sentence on what the setting does, read with the switch. */
  hint: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** A labelled on/off setting with a sentence on what it does. */
export function SettingsSwitch({
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: SettingsSwitchProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p id={`${id}-description`} className="text-xs text-pretty text-muted-foreground">
          {hint}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-describedby={`${id}-description`}
      />
    </div>
  );
}

/** The small print on what leaves Orbit when a setting is on. */
export function PrivacyNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs text-pretty text-muted-foreground">
      <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      {children}
    </p>
  );
}

/** A settings page's placeholder while its settings load. */
export function SettingsLoading({ label, className }: { label: string; className: string }) {
  return (
    <div aria-busy="true">
      <span className="sr-only">{label}</span>
      <Skeleton className={cn("w-full rounded-2xl", className)} />
    </div>
  );
}
