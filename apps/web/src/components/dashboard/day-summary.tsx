"use client";

import type { BriefingContent, BriefingSourceRef } from "@orbit/contracts";
import {
  AlarmClock,
  Cake,
  CalendarDays,
  CheckSquare,
  CreditCard,
  Dumbbell,
  FileText,
  Landmark,
  ListChecks,
  type LucideIcon,
  MoreHorizontal,
  NotebookPen,
  PiggyBank,
  Repeat2,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { NarratedBriefing } from "@/hooks/use-briefing";
import { briefingItemHrefs } from "@/lib/briefing";
import { calendarHref } from "@/lib/calendar";
import { financeViewHref } from "@/lib/finance-views";
import { peopleHref } from "@/lib/people";
import { cn } from "@/utils/common";

const ICONS: Record<BriefingSourceRef["type"], LucideIcon> = {
  task: CheckSquare,
  event: CalendarDays,
  reminder: AlarmClock,
  commitment: CreditCard,
  budget: PiggyBank,
  savings_goal: Target,
  person: Cake,
  habit: Repeat2,
  routine: ListChecks,
  workout: Dumbbell,
  fitness_goal: Target,
  note: NotebookPen,
  document: FileText,
  shopping_list: ShoppingCart,
  sip: TrendingUp,
  deposit: Landmark,
};

function isRecordType(value: string): value is BriefingSourceRef["type"] {
  return Object.hasOwn(ICONS, value);
}

/** The record type a `ref.key` names: everything before its first colon. */
function typeOf(key: string): BriefingSourceRef["type"] | null {
  const type = key.slice(0, key.indexOf(":"));
  return isRecordType(type) ? type : null;
}

/** Shown in the greeting while today's summary is being prepared and written. */
export function SummaryWriting() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-4 rounded-xl border border-brand/20 bg-brand-subtle/50 px-4 py-3"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-brand">
        <Sparkles className="size-4 animate-pulse" aria-hidden="true" />
        Summarizing your day…
      </p>
      <div className="mt-3 space-y-2" aria-hidden="true">
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}

/** A quiet note when the summary couldn't be written; the rest of the greeting is unaffected. */
export function SummaryFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Sparkles className="size-3.5" aria-hidden="true" />
      <span>{message}</span>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/**
 * Today's AI-written summary: a headline and a few sentences, what to focus on (each linking
 * to its record), and the day at a glance. Everything but the wording comes from Orbit's own
 * briefing, so the counts and links are always right even if the wording isn't.
 */
export function DaySummary({
  briefing,
  timeZone,
  onRefresh,
  onSettings,
}: {
  briefing: NarratedBriefing;
  timeZone: string;
  onRefresh: () => void;
  onSettings: () => void;
}) {
  const { narrative, content } = briefing;
  const hrefs = briefingItemHrefs(content, briefing.date);
  const written = new Date(narrative.generated_at).toLocaleTimeString([], {
    timeStyle: "short",
    timeZone,
  });

  return (
    <section aria-label="Your day, summarized" className="@container mt-4 space-y-4">
      <div className="space-y-1.5">
        <p className="flex items-start gap-2 text-base font-semibold text-balance">
          <Sparkles className="mt-1 size-4 shrink-0 text-brand" aria-hidden="true" />
          {narrative.headline}
        </p>
        <p className="max-w-prose text-sm text-pretty text-foreground/85">{narrative.summary}</p>
      </div>

      {narrative.priorities.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Focus on
          </h3>
          <ol className="grid gap-2 @xl:grid-cols-3">
            {narrative.priorities.map((priority, index) => {
              const type = typeOf(priority.key);
              const Icon = type ? ICONS[type] : Sparkles;
              const href = hrefs.get(priority.key);
              const body = (
                <>
                  <span className="flex items-center gap-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand-subtle text-xs font-semibold text-brand tabular-nums">
                      {index + 1}
                    </span>
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 truncate text-sm font-medium">{priority.title}</span>
                  </span>
                  {priority.reason ? (
                    <span className="mt-1 block text-xs text-pretty text-muted-foreground">
                      {priority.reason}
                    </span>
                  ) : null}
                </>
              );
              const card =
                "block h-full rounded-lg border bg-background/70 px-3 py-2.5 transition-colors duration-150";
              return (
                <li key={priority.key}>
                  {href ? (
                    <Link
                      href={href}
                      className={cn(
                        card,
                        "outline-none hover:border-foreground/15 focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className={card}>{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      <AtAGlance content={content} day={briefing.date} />

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
        <p className="text-xs text-muted-foreground">
          Summarized at {written} by {narrative.provider_name}
          {narrative.processing === "local" ? " on your server" : " in the cloud"}. It can be wrong;
          the details below are Orbit’s own.
        </p>
        <Menu
          variant="ghost"
          size="icon"
          chevron={false}
          align="end"
          aria-label="Summary options"
          className="size-8 shrink-0"
          items={[
            {
              id: "refresh",
              label: "Refresh summary",
              description: "Read your day again and rewrite it.",
              onSelect: onRefresh,
            },
            {
              id: "settings",
              label: "Briefing settings",
              description: "What it covers, and when it’s prepared.",
              onSelect: onSettings,
            },
          ]}
        >
          <MoreHorizontal aria-hidden="true" />
        </Menu>
      </div>
    </section>
  );
}

type Chip = { label: string; href: string; icon: LucideIcon; urgent?: boolean };

/** Small counts the summary's wording can lean on, only those that aren't zero. */
function AtAGlance({ content, day }: { content: BriefingContent; day: string }) {
  const s = content.summary;
  const chips: Chip[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (s.events > 0)
    chips.push({
      label:
        plural(s.events, "event", "events") +
        (s.conflicts > 0 ? `, ${s.conflicts} overlapping` : ""),
      href: calendarHref({ view: "day", date: day }),
      icon: CalendarDays,
      urgent: s.conflicts > 0,
    });
  if (s.tasks_overdue > 0)
    chips.push({
      label: `${s.tasks_overdue} overdue`,
      href: "/tasks",
      icon: CheckSquare,
      urgent: true,
    });
  if (s.tasks_due_today > 0)
    chips.push({
      label: plural(s.tasks_due_today, "task due", "tasks due"),
      href: "/tasks",
      icon: CheckSquare,
    });
  if (s.payments_overdue + s.payments_due > 0)
    chips.push({
      label:
        s.payments_overdue > 0
          ? plural(s.payments_overdue, "payment late", "payments late")
          : plural(s.payments_due, "payment due", "payments due"),
      href: financeViewHref("subscriptions"),
      icon: CreditCard,
      urgent: s.payments_overdue > 0,
    });
  if (s.budgets_exceeded > 0)
    chips.push({
      label: plural(s.budgets_exceeded, "budget over", "budgets over"),
      href: financeViewHref("budgets"),
      icon: PiggyBank,
      urgent: true,
    });
  if (s.habits_remaining > 0)
    chips.push({
      label: plural(s.habits_remaining, "habit to go", "habits to go"),
      href: "/habits",
      icon: Repeat2,
    });
  if (s.workouts > 0)
    chips.push({
      label: plural(s.workouts, "workout", "workouts"),
      href: "/health",
      icon: Dumbbell,
    });
  // Older briefings were stored before People joined, so the section can be missing.
  const celebrations = content.people?.today ?? 0;
  if (celebrations > 0)
    chips.push({
      label: plural(celebrations, "celebration today", "celebrations today"),
      href: peopleHref("upcoming"),
      icon: Cake,
    });
  if (chips.length === 0) return null;

  return (
    <ul aria-label="At a glance" className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.label}>
          <Link
            href={chip.href}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-2.5 py-1 text-xs outline-none hover:border-foreground/15 focus-visible:ring-2 focus-visible:ring-ring",
              chip.urgent && "border-destructive/30 text-destructive",
            )}
          >
            <chip.icon className="size-3.5" aria-hidden="true" />
            {chip.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
