"use client";

import {
  AlarmClock,
  BellRing,
  CheckSquare,
  CreditCard,
  FileWarning,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { useTodayOverview } from "@/hooks/use-today-overview";
import { attentionItems, type AttentionKind } from "@/lib/dashboard";
import { cn } from "@/utils/common";

import { WidgetBody, WidgetCard, WidgetEmpty } from "./widget-card";

const ICONS: Record<AttentionKind, LucideIcon> = {
  overdue_task: CheckSquare,
  reminder: AlarmClock,
  expired_document: FileWarning,
  expiring_document: FileWarning,
  overdue_payment: CreditCard,
  payment_due: CreditCard,
};

const SHOWN = 8;

/**
 * Overdue tasks, reminders due today, expired and expiring documents, and payments due, in one
 * list. It reads the daily overview, so it adds no requests; payment amounts are left out.
 */
export function AttentionWidget() {
  const { resource, reload, timeZone } = useTodayOverview();
  return (
    <WidgetCard
      title="Needs attention"
      icon={BellRing}
      href="/reminders"
      linkLabel="Open reminders"
      busy={resource.status === "loading"}
    >
      <WidgetBody resource={resource} reload={reload} label="what needs attention">
        {(overview) => {
          const items = attentionItems(overview, timeZone);
          if (items.length === 0) {
            return (
              <WidgetEmpty>
                {overview.unavailable.length > 0
                  ? "Some modules couldn’t be checked just now."
                  : "Nothing needs attention. You’re all caught up."}
              </WidgetEmpty>
            );
          }
          return (
            <div className="p-5">
              <ul className="divide-y rounded-lg border">
                {items.slice(0, SHOWN).map((item) => {
                  const Icon = ICONS[item.kind];
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        className="flex items-center gap-3 px-3 py-2 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      >
                        <Icon
                          className={cn(
                            "size-4 shrink-0",
                            item.urgent ? "text-destructive" : "text-muted-foreground",
                          )}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                        <span
                          className={cn(
                            "shrink-0 text-xs",
                            item.urgent ? "font-medium text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {item.detail}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {items.length > SHOWN ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  And {items.length - SHOWN} more.
                </p>
              ) : null}
            </div>
          );
        }}
      </WidgetBody>
    </WidgetCard>
  );
}
