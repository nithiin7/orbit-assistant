"use client";

import { Lightbulb, X } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useInsights } from "@/hooks/use-ai";
import { recordHref } from "@/lib/ai";
import { cn } from "@/utils/common";
import { formatCalendarDate } from "@/utils/dates";

/**
 * A few observations calculated from your records (no model involved). Each names its period
 * and can be dismissed until the period changes. Shown here only, never as notifications.
 */
export function InsightsPanel() {
  const { resource, dismiss } = useInsights(true);
  if (resource.status === "loading") return <Skeleton className="h-24 w-full rounded-xl" />;
  if (resource.status === "error") {
    return <p className="text-xs text-muted-foreground">{resource.message}</p>;
  }
  if (resource.data.length === 0) return null;
  return (
    <section aria-labelledby="insights-heading" className="space-y-2">
      <h2 id="insights-heading" className="flex items-center gap-1.5 text-sm font-semibold">
        <Lightbulb className="size-4 text-brand" aria-hidden="true" />
        Insights
      </h2>
      <ul className="grid gap-2 md:grid-cols-2">
        {resource.data.map((insight) => (
          <li
            key={insight.key}
            className={cn(
              "relative space-y-1 rounded-xl border bg-card p-3 pr-10 shadow-elevation-1",
              insight.tone === "attention" && "border-l-4 border-l-warning",
              insight.tone === "positive" && "border-l-4 border-l-success",
            )}
          >
            <p className="text-sm font-medium">{insight.title}</p>
            <p className="text-xs text-pretty text-muted-foreground">{insight.body}</p>
            <p className="text-[0.7rem] text-muted-foreground">
              {formatCalendarDate(insight.period_start)} – {formatCalendarDate(insight.period_end)}
              {insight.refs.length ? " · " : ""}
              {insight.refs.slice(0, 3).map((ref, index) => {
                const href = recordHref(ref);
                return href ? (
                  <Link
                    key={`${ref.kind}-${index}`}
                    href={href}
                    className="mr-1.5 text-brand hover:underline"
                  >
                    {ref.title}
                  </Link>
                ) : null;
              })}
            </p>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1.5 right-1.5 size-7"
              aria-label={`Dismiss: ${insight.title}`}
              onClick={() => dismiss(insight.key)}
            >
              <X aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
