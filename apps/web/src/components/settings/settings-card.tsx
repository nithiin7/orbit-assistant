"use client";

import { type LucideIcon, ShieldCheck } from "lucide-react";
import { createContext, type ReactNode, use, useId } from "react";

import { IconChip, type IconChipTone } from "@/components/ui/icon-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/utils/common";

/** The open settings page's colour, so every card on it shares the menu row's icon colour. */
const SettingsToneContext = createContext<IconChipTone>("brand");

export function SettingsToneProvider({
  tone,
  children,
}: {
  tone: IconChipTone;
  children: ReactNode;
}) {
  return <SettingsToneContext value={tone}>{children}</SettingsToneContext>;
}

/** A faint wash of the card's colour behind its header. Written out in full for Tailwind. */
const HEADER_WASH: Record<IconChipTone, string> = {
  brand: "from-brand-subtle/70",
  blue: "from-event-blue/8",
  green: "from-event-green/8",
  amber: "from-event-amber/10",
  violet: "from-event-violet/8",
  teal: "from-event-teal/8",
  orange: "from-event-orange/8",
  rose: "from-event-rose/8",
  slate: "from-event-slate/8",
  success: "from-success/8",
  warning: "from-warning/10",
  danger: "from-destructive/8",
};

/** The rounded icon at the start of a settings card's header. */
export function IconTile({
  icon,
  muted = false,
  tone,
}: {
  icon: LucideIcon;
  muted?: boolean;
  tone?: IconChipTone;
}) {
  const pageTone = use(SettingsToneContext);
  return (
    <IconChip
      icon={icon}
      tone={tone ?? pageTone}
      className={cn(
        "size-10 ring-1 ring-border/50 [&>svg]:size-4.5",
        muted && "bg-muted text-muted-foreground",
      )}
    />
  );
}

type SettingsCardProps = {
  /** The title's id, which names the card for assistive tech. */
  titleId: string;
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  /** The icon's colour; by default the open settings page's. `danger` marks a danger zone. */
  tone?: IconChipTone;
  /** Beside the title, e.g. a status badge or a button. */
  action?: ReactNode;
  /** The card's own id, for links to it. */
  id?: string;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  /** The card's controls. Leave out for a header-only card, e.g. one action in the header. */
  children?: ReactNode;
};

/**
 * A settings card: a softly tinted header with an icon, a title, and one line on what it's for,
 * then its controls.
 */
export function SettingsCard({
  titleId,
  icon,
  title,
  description,
  tone,
  action,
  id,
  className,
  headerClassName,
  bodyClassName,
  children,
}: SettingsCardProps) {
  const pageTone = use(SettingsToneContext);
  const cardTone = tone ?? pageTone;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn(
        "scroll-mt-6 overflow-hidden rounded-2xl border bg-card shadow-elevation-1",
        cardTone === "danger" && "border-destructive/30",
        className,
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-center gap-3.5 bg-linear-to-br via-card to-card px-4 py-4 sm:px-5",
          HEADER_WASH[cardTone],
          headerClassName,
        )}
      >
        <IconTile icon={icon} tone={cardTone} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2
            id={titleId}
            className={cn(
              "text-base font-semibold tracking-tight",
              cardTone === "danger" && "text-destructive",
            )}
          >
            {title}
          </h2>
          {description ? (
            <p className="text-sm text-pretty text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </header>
      {children ? (
        <div className={cn("space-y-5 border-t border-border/60 px-4 py-5 sm:px-5", bodyClassName)}>
          {children}
        </div>
      ) : null}
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

/** A labelled on/off setting with a sentence on what it does, on its own soft tile. */
export function SettingsSwitch({
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: SettingsSwitchProps) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-muted/30 px-3.5 py-3 transition-colors duration-150 hover:bg-muted/50",
        disabled && "opacity-70 hover:bg-muted/30",
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
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
    <p className="flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-xs text-pretty text-muted-foreground">
      <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success" />
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
