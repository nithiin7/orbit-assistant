"use client";

import { ArrowRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Resource } from "@/hooks/query-resource";
import { cn } from "@/utils/common";

/**
 * The frame dashboard widgets share: a heading with an icon, an optional action, a link to the
 * module it summarizes, and the widget's body.
 */
export function WidgetCard({
  title,
  icon: Icon,
  href,
  linkLabel,
  actions,
  busy = false,
  children,
  className,
}: {
  title: string;
  icon: LucideIcon;
  /** The module page the widget summarizes. */
  href: string;
  /** The link's text, such as "Open tasks". */
  linkLabel: string;
  actions?: ReactNode;
  busy?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="h-full">
      <Card className={cn("flex h-full flex-col shadow-elevation-1", className)} aria-busy={busy}>
        <div className="widget-header flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-5 py-4">
          <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold">
            <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            {title}
          </h2>
          <div className="flex flex-wrap items-center gap-1">
            {actions}
            <Link href={href} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {linkLabel}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </Card>
    </section>
  );
}

/** A widget's loading, error, and success states, so each widget fails on its own. */
export function WidgetBody<T>({
  resource,
  reload,
  label,
  children,
}: {
  resource: Resource<T>;
  reload: () => void;
  /** What is loading, for screen readers: "tasks". */
  label: string;
  children: (data: T) => ReactNode;
}) {
  if (resource.status === "loading") {
    return (
      <div className="widget-body space-y-2 p-5">
        <span className="sr-only">Loading {label}…</span>
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  if (resource.status === "error") {
    return (
      <div
        role="alert"
        className="widget-body flex flex-wrap items-center justify-between gap-3 p-5"
      >
        <p className="text-sm text-muted-foreground">{resource.message}</p>
        <Button variant="outline" size="sm" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  return <>{children(resource.data)}</>;
}

/** A row of choices inside a widget (Today, Priority, …), as a set of toggle buttons. */
export function WidgetTabs<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {option.label}
            {option.count ? (
              <span className={cn("tabular-nums", selected ? "opacity-80" : "")}>
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** A quiet line for an empty widget, with an optional link onward. */
export function WidgetEmpty({ children }: { children: ReactNode }) {
  return <p className="widget-body p-5 text-sm text-muted-foreground">{children}</p>;
}
