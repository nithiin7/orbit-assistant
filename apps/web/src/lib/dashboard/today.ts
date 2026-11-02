import type { TodayOverview } from "@orbit/contracts";

import { documentsHref } from "@/lib/documents";
import { financeViewHref } from "@/lib/finance-views";
import { daysBetween, formatCalendarDate } from "@/utils/dates";
import { localParts } from "@/utils/time-zones";

/** A greeting for the hour on the viewer's clock (0–23). */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

/** The hour (0–23) on `timeZone`'s clock. */
export function hourIn(timeZone: string, now: Date = new Date()): number {
  return Number(localParts(now, timeZone).time.slice(0, 2));
}

/** The first word of a display name, for a friendly greeting; empty when there is no name. */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? "";
}

/** A calendar date as a heading: "Monday, 2 November". */
export function formatDayHeading(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
}

export type AttentionKind =
  | "overdue_task"
  | "reminder"
  | "expired_document"
  | "expiring_document"
  | "overdue_payment"
  | "payment_due";

export type AttentionItem = {
  id: string;
  kind: AttentionKind;
  title: string;
  /** Why it needs attention: "Overdue by 3 days", "Expires 12 Nov". */
  detail: string;
  /** Where to deal with it. */
  href: string;
  /** Overdue and expired items are urgent; the rest are coming up. */
  urgent: boolean;
};

function overdueBy(days: number): string {
  return days === 1 ? "Overdue by 1 day" : `Overdue by ${days} days`;
}

function inDays(today: string, date: string): string {
  const days = daysBetween(today, date);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return formatCalendarDate(date, { omitYearIn: Number(today.slice(0, 4)) });
}

/**
 * What needs attention today, from the overview: overdue tasks, reminders due today, expired and
 * expiring documents, and payments overdue or due soon. Urgent items come first; sections that
 * didn't load are left out (the widget says so).
 */
export function attentionItems(overview: TodayOverview, timeZone: string): AttentionItem[] {
  const today = overview.date;
  const items: AttentionItem[] = [];
  for (const task of overview.tasks?.overdue_items ?? []) {
    items.push({
      id: `task-${task.id}`,
      kind: "overdue_task",
      title: task.title,
      detail: task.due_date ? overdueBy(daysBetween(task.due_date, today)) : "Overdue",
      href: `/tasks?task=${encodeURIComponent(task.id)}`,
      urgent: true,
    });
  }
  for (const document of overview.documents?.items ?? []) {
    const expired = document.expiry_date < today;
    items.push({
      id: `document-${document.id}`,
      kind: expired ? "expired_document" : "expiring_document",
      title: document.title,
      detail: expired
        ? `Expired ${formatCalendarDate(document.expiry_date, { omitYearIn: Number(today.slice(0, 4)) })}`
        : `Expires ${inDays(today, document.expiry_date)}`,
      href: documentsHref({ documentId: document.id }),
      urgent: expired,
    });
  }
  for (const payment of overview.payments?.items ?? []) {
    const overdue = payment.status === "overdue";
    items.push({
      id: `payment-${payment.commitment_id}-${payment.due_date}`,
      kind: overdue ? "overdue_payment" : "payment_due",
      title: payment.name,
      detail: overdue
        ? overdueBy(daysBetween(payment.due_date, today))
        : `Due ${inDays(today, payment.due_date)}`,
      href: financeViewHref("upcoming"),
      urgent: overdue,
    });
  }
  for (const reminder of overview.reminders?.items ?? []) {
    const at = new Date(reminder.next_occurrence_at);
    const due = at.getTime() <= Date.parse(overview.generated_at);
    items.push({
      id: `reminder-${reminder.id}`,
      kind: "reminder",
      title: reminder.title,
      detail: due
        ? "Due now"
        : `Today at ${at.toLocaleTimeString([], { timeStyle: "short", timeZone })}`,
      href: "/reminders",
      urgent: due,
    });
  }
  // Stable: within each group, the overview's own order (most overdue, soonest) is kept.
  return [...items.filter((item) => item.urgent), ...items.filter((item) => !item.urgent)];
}
