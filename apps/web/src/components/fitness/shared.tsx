"use client";

import type { Exercise, FitnessLinkedRecord } from "@orbit/contracts";
import { FileLock2, Link2, NotebookPen, Search, X } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { type LinkOwner, type LinkTarget, setFitnessLink } from "@/api/fitness";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { Resource } from "@/hooks/query-resource";
import { useFitnessAction, useLinkCandidates, usePhotoFile } from "@/hooks/use-fitness";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { documentsHref } from "@/lib/documents";
import { EXERCISE_CATEGORIES, labelOf } from "@/lib/fitness";
import { noteHref } from "@/lib/note-links";
import { cn } from "@/utils/common";
import { formatCalendarDate } from "@/utils/dates";

import { ViewError } from "../habits/view-error";

/** A titled card for one part of a view, with an optional action beside the title. */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn("space-y-3 rounded-xl border bg-card p-4", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h2 id={id} className="text-sm font-semibold">
            {title}
          </h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Renders a resource's loading and error states, and its data once loaded. */
export function Loaded<T>({
  resource,
  reload,
  children,
  skeleton = "h-40",
}: {
  resource: Resource<T>;
  reload: () => void;
  children: (data: T) => ReactNode;
  skeleton?: string;
}) {
  if (resource.status === "loading") {
    return (
      <div aria-busy="true" aria-label="Loading">
        <Skeleton className={cn("w-full rounded-xl", skeleton)} />
      </div>
    );
  }
  if (resource.status === "error") return <ViewError message={resource.message} onRetry={reload} />;
  return <>{children(resource.data)}</>;
}

/** A labelled progress bar toward a target. */
export function Meter({
  label,
  value,
  fraction,
  tone = "brand",
}: {
  label: string;
  /** What the bar shows, such as "1,200 of 2,000 kcal". */
  value: string;
  /** 0 to 1, or `null` without a target. */
  fraction: number | null;
  tone?: "brand" | "success" | "chart";
}) {
  const percent = fraction === null ? 0 : Math.round(fraction * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">{value}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fraction === null ? undefined : percent}
        aria-valuetext={value}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            tone === "success" ? "bg-success" : tone === "chart" ? "bg-chart-1" : "bg-brand",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export type ChartPoint = { label: string; value: number };

/**
 * A small line chart of values over time. The SVG is decorative; the same values are in a
 * visually hidden table for screen readers.
 */
export function LineChart({
  points,
  format,
  title,
  height = 120,
}: {
  points: readonly ChartPoint[];
  format: (value: number) => string;
  title: string;
  height?: number;
}) {
  if (points.length === 0) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 300;
  const pad = 6;
  const x = (i: number) =>
    points.length === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (points.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <figure className="space-y-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-32 w-full overflow-visible text-brand"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => (
          <circle key={`${p.label}-${i}`} cx={x(i)} cy={y(p.value)} r={2.5} fill="currentColor" />
        ))}
      </svg>
      <figcaption className="flex justify-between text-xs text-muted-foreground">
        <span>{first ? `${first.label}: ${format(first.value)}` : null}</span>
        <span>{last && last !== first ? `${last.label}: ${format(last.value)}` : null}</span>
      </figcaption>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {points.map((p, i) => (
            <tr key={`${p.label}-${i}`}>
              <th scope="row">{p.label}</th>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Vertical bars, one per period, with the same values in a hidden table. */
export function BarChart({
  bars,
  format,
  title,
}: {
  bars: readonly ChartPoint[];
  format: (value: number) => string;
  title: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <figure>
      <div className="flex h-32 items-end gap-1" aria-hidden="true">
        {bars.map((bar, i) => (
          <div key={`${bar.label}-${i}`} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full max-w-8 rounded-t bg-brand/80"
              style={{ height: `${Math.max(bar.value > 0 ? 4 : 0, (bar.value / max) * 100)}%` }}
              title={`${bar.label}: ${format(bar.value)}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-muted-foreground" aria-hidden="true">
        {bars.map((bar, i) => (
          <span key={`${bar.label}-${i}`} className="flex-1 truncate text-center">
            {bar.label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {bars.map((bar, i) => (
            <tr key={`${bar.label}-${i}`}>
              <th scope="row">{bar.label}</th>
              <td>{format(bar.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function shortDate(day: string): string {
  return formatCalendarDate(day, { omitYearIn: new Date().getFullYear() });
}

/** A labelled numeric text input with an optional unit after it. */
export function NumberInput({
  label,
  value,
  onChange,
  unit,
  className,
  hideLabel = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: string;
  className?: string;
  hideLabel?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={id} className={cn("block text-xs font-medium", hideLabel && "sr-only")}>
        {label}
        {unit && hideLabel ? ` (${unit})` : null}
      </label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={cn("tabular-nums", unit && "pr-10")}
        />
        {unit ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground"
          >
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** A modal list of exercises to choose from, searchable by name, muscle, or category. */
export function ExercisePicker({
  exercises,
  onPick,
  onClose,
  title = "Add an exercise",
}: {
  exercises: readonly Exercise[];
  onPick: (exercise: Exercise) => void;
  onClose: () => void;
  title?: string;
}) {
  const id = useId();
  const { close, dialogProps } = useModalDialog({ onClose });
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = exercises.filter(
    (exercise) =>
      !exercise.archived &&
      words.every((word) =>
        [
          exercise.name,
          labelOf(EXERCISE_CATEGORIES, exercise.category),
          ...exercise.primary_muscles,
        ]
          .join(" ")
          .toLowerCase()
          .replaceAll("_", " ")
          .includes(word),
      ),
  );
  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-title`}
      className="dialog-motion dialog-pop mx-auto mt-[6vh] max-h-[88vh] w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <div className="flex items-center justify-between gap-2 border-b p-4">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          {title}
        </h2>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Close" onClick={close}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="relative border-b p-3">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          autoFocus
          aria-label="Search exercises"
          placeholder="Search by name or muscle"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-8"
        />
      </div>
      <ul className="max-h-[55vh] overflow-y-auto p-2">
        {matches.length === 0 ? (
          <li className="p-4 text-center text-sm text-muted-foreground">No exercises match.</li>
        ) : (
          matches.map((exercise) => (
            <li key={exercise.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(exercise);
                  close();
                }}
                className="flex w-full flex-col items-start rounded-md px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-sm font-medium">{exercise.name}</span>
                <span className="text-xs text-muted-foreground">
                  {labelOf(EXERCISE_CATEGORIES, exercise.category)}
                  {exercise.primary_muscles.length > 0
                    ? ` · ${exercise.primary_muscles.join(", ").replaceAll("_", " ")}`
                    : ""}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </dialog>
  );
}

/** A progress photo, fetched with the token and shown through an object URL. */
export function PhotoImage({
  workspaceId,
  photoId,
  alt,
  className,
}: {
  workspaceId: string;
  photoId: string;
  alt: string;
  className?: string;
}) {
  const result = usePhotoFile(workspaceId, photoId);
  const image = useRef<HTMLImageElement>(null);
  const blob = result.data;

  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  if (result.isError) {
    return (
      <p role="alert" className="p-4 text-center text-xs text-muted-foreground">
        {describeApiError(result.error, "Couldn’t load this photo.")}
      </p>
    );
  }
  if (!blob) return <Skeleton className={cn("aspect-[3/4] w-full", className)} />;
  return (
    // An object URL can't go through the Next.js image loader.
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={image} alt={alt} className={cn("aspect-[3/4] w-full object-cover", className)} />
  );
}

/**
 * Notes and documents linked to a workout or goal: open, unlink, or link more. The records stay
 * in Notes and Documents; this only relates them.
 */
export function LinkedRecords({
  workspaceId,
  owner,
  ownerId,
  links,
  children,
}: {
  workspaceId: string;
  owner: LinkOwner;
  ownerId: string;
  links: readonly FitnessLinkedRecord[];
  /** More actions beside "Link", such as writing a new note. */
  children?: ReactNode;
}) {
  const run = useFitnessAction(workspaceId);
  const [picking, setPicking] = useState<LinkTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setLink = (target: LinkTarget, targetId: string, linked: boolean) => {
    setError(null);
    run((token) => setFitnessLink(token, workspaceId, owner, ownerId, target, targetId, linked), {
      workout: false,
    }).catch((reason: unknown) =>
      setError(describeApiError(reason, "Couldn’t change the link. Try again.")),
    );
  };

  return (
    <div className="space-y-2">
      {links.length > 0 ? (
        <ul className="space-y-1">
          {links.map((link) => (
            <li key={`${link.kind}-${link.id}`} className="flex items-center justify-between gap-2">
              <Link
                href={
                  link.kind === "note" ? noteHref(link.id) : documentsHref({ documentId: link.id })
                }
                className="flex min-w-0 items-center gap-2 text-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {link.kind === "note" ? (
                  <NotebookPen
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                ) : (
                  <FileLock2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{link.title}</span>
              </Link>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Unlink ${link.title}`}
                onClick={() => setLink(link.kind, link.id, false)}
              >
                Unlink
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No linked notes or documents.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {children}
        <Menu
          variant="ghost"
          size="sm"
          items={[
            {
              id: "note",
              label: "Link a note",
              icon: NotebookPen,
              onSelect: () => setPicking("note"),
            },
            {
              id: "document",
              label: "Link a document",
              description: "Such as a training plan or a report.",
              icon: FileLock2,
              onSelect: () => setPicking("document"),
            },
          ]}
        >
          <Link2 aria-hidden="true" />
          Link
        </Menu>
      </div>
      <p role="alert" className="text-xs text-destructive empty:hidden">
        {error}
      </p>
      {picking ? (
        <LinkPicker
          workspaceId={workspaceId}
          kind={picking}
          onClose={() => setPicking(null)}
          onPick={(targetId) => setLink(picking, targetId, true)}
        />
      ) : null}
    </div>
  );
}

function LinkPicker({
  workspaceId,
  kind,
  onPick,
  onClose,
}: {
  workspaceId: string;
  kind: LinkTarget;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const { close, dialogProps } = useModalDialog({ onClose });
  const [query, setQuery] = useState("");
  const candidates = useLinkCandidates(workspaceId, kind, query);
  const noun = kind === "note" ? "note" : "document";
  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-title`}
      className="dialog-motion dialog-pop mx-auto mt-[6vh] max-h-[88vh] w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <div className="flex items-center justify-between gap-2 border-b p-4">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          Link a {noun}
        </h2>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Close" onClick={close}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="border-b p-3">
        <Input
          autoFocus
          aria-label={`Search ${noun}s`}
          placeholder={`Search ${noun}s`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="max-h-[55vh] overflow-y-auto p-2">
        <Loaded resource={candidates} reload={() => setQuery(query)} skeleton="h-24">
          {(items) =>
            items.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">No {noun}s match.</p>
            ) : (
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(item.id);
                        close();
                      }}
                      className="w-full rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {item.title}
                    </button>
                  </li>
                ))}
              </ul>
            )
          }
        </Loaded>
      </div>
    </dialog>
  );
}
