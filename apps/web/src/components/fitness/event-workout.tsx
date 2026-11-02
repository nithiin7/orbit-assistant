"use client";

import { Dumbbell } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { linkScheduledWorkout, unlinkScheduledWorkout } from "@/api/fitness";
import { Button } from "@/components/ui/button";
import { useFitnessAction, useScheduledWorkout } from "@/hooks/use-fitness";
import { todayIn } from "@/lib/calendar";
import { fitnessHref } from "@/lib/fitness";

import { useStartWorkout } from "./workouts";

/**
 * The workout a calendar event schedules, in the event's details: start it, open the workouts
 * started from it, or mark an ordinary event as a workout. The event itself stays a normal
 * calendar event, so its alerts remain the reminders.
 */
export function EventWorkout({
  workspaceId,
  eventId,
  timeZone,
}: {
  workspaceId: string;
  eventId: string;
  timeZone: string;
}) {
  const headingId = useId();
  const { state } = useScheduledWorkout(workspaceId, eventId);
  const run = useFitnessAction(workspaceId);
  const start = useStartWorkout(workspaceId, todayIn(timeZone), timeZone);
  const [error, setError] = useState<string | null>(null);

  // Health records are optional here: if they can't load, the event details still work.
  if (state.status !== "success") return null;
  const scheduled = state.data;

  const fail = (fallback: string) => (reason: unknown) =>
    setError(describeApiError(reason, fallback));

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="flex items-center gap-2 text-sm font-medium">
        <Dumbbell aria-hidden="true" className="size-4 text-muted-foreground" />
        Workout
      </h3>
      {scheduled === null ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            run((token) => linkScheduledWorkout(token, workspaceId, eventId, null), {
              touches: ["calendar"],
            }).catch(fail("Couldn’t mark it as a workout."))
          }
        >
          Mark as a workout
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {scheduled.template_name
              ? `From the ${scheduled.template_name} template.`
              : "A workout."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="soft"
              onClick={() =>
                start(scheduled.template_id, eventId).catch(fail("Couldn’t start the workout."))
              }
            >
              Start workout
            </Button>
            {scheduled.session_ids.map((id, index) => (
              <Link
                key={id}
                href={fitnessHref({ kind: "workout", id })}
                className="inline-flex h-8 items-center rounded-md px-3 text-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {scheduled.session_ids.length > 1 ? `Workout ${index + 1}` : "Open workout"}
              </Link>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                run((token) => unlinkScheduledWorkout(token, workspaceId, eventId), {
                  touches: ["calendar"],
                }).catch(fail("Couldn’t change it."))
              }
            >
              Not a workout
            </Button>
          </div>
        </div>
      )}
      <p role="alert" className="text-xs text-destructive empty:hidden">
        {error}
      </p>
    </section>
  );
}
