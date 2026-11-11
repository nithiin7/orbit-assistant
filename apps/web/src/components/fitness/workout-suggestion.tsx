"use client";

import type { AiWorkoutSuggestion } from "@orbit/contracts";
import { RotateCcw } from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { saveTemplate } from "@/api/fitness";
import { DialogShell } from "@/components/dialog-shell";
import { FormAlert, FormField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSuggestWorkout } from "@/hooks/use-ai";
import { useFitnessAction } from "@/hooks/use-fitness";
import { processingLabel } from "@/lib/ai";
import {
  formatDistance,
  formatDuration,
  labelOf,
  suggestionTemplateRequest,
  TEMPLATE_CATEGORIES,
  type Units,
} from "@/lib/fitness";

function describeSuggested(item: AiWorkoutSuggestion["exercises"][number], units: Units): string {
  const parts: string[] = [];
  const { target_reps_min: min, target_reps_max: max } = item;
  const reps = min && max && min !== max ? `${min}–${max}` : (max ?? min);
  parts.push(reps ? `${item.sets} × ${reps}` : `${item.sets} sets`);
  if (item.target_duration_s) parts.push(formatDuration(item.target_duration_s));
  if (item.target_distance_m)
    parts.push(formatDistance(item.target_distance_m, units.distance_unit));
  if (item.rest_seconds) parts.push(`rest ${item.rest_seconds} s`);
  return parts.join(" · ");
}

/**
 * Ask AI for a workout from the person's own exercise library, shaped by their goals and recent
 * workouts, then save it as a template or try again. Nothing is saved until they choose to.
 */
export function WorkoutSuggestionDialog({
  workspaceId,
  units,
  onClose,
}: {
  workspaceId: string;
  units: Units;
  onClose: () => void;
}) {
  const suggest = useSuggestWorkout(workspaceId);
  const run = useFitnessAction(workspaceId);
  const [focus, setFocus] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = suggest.data;

  async function save(close: () => void) {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await run((token) =>
        saveTemplate(token, workspaceId, null, suggestionTemplateRequest(draft)),
      );
      close();
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t save the template."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell
      title="Suggest a workout"
      description="Built from your exercise library, your active goals, and your last two weeks of workouts. General fitness ideas, not medical advice."
      busy={saving || suggest.isPending}
      onClose={onClose}
      onSubmit={(event, close) => {
        event.preventDefault();
        if (draft) void save(close);
        else suggest.mutate(focus.trim());
      }}
      submitLabel={draft ? "Save as template" : suggest.isPending ? "Suggesting…" : "Suggest"}
      wide
    >
      <FormField
        label="What would you like?"
        placeholder="45 minutes, upper body, dumbbells only"
        maxLength={200}
        autoComplete="off"
        value={focus}
        onChange={(event) => setFocus(event.target.value)}
        disabled={suggest.isPending || saving}
      />
      <FormAlert
        message={
          suggest.isError ? describeApiError(suggest.error, "Couldn’t suggest a workout.") : null
        }
      />
      {draft ? (
        <section aria-label="Suggested workout" className="space-y-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <h3 className="text-sm font-semibold">{draft.name}</h3>
              {draft.description ? (
                <p className="text-xs text-muted-foreground">{draft.description}</p>
              ) : null}
            </div>
            <Badge>{labelOf(TEMPLATE_CATEGORIES, draft.category)}</Badge>
          </div>
          <ol className="space-y-1.5">
            {draft.exercises.map((item, index) => (
              <li key={item.exercise_id} className="text-sm">
                <span className="text-muted-foreground tabular-nums">{index + 1}. </span>
                {item.exercise_name}
                <span className="text-xs text-muted-foreground">
                  {" "}
                  · {describeSuggested(item, units)}
                </span>
                {item.notes ? (
                  <span className="block pl-4 text-xs text-muted-foreground">{item.notes}</span>
                ) : null}
              </li>
            ))}
          </ol>
          {draft.notes ? <p className="text-xs text-muted-foreground">{draft.notes}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-xs text-muted-foreground">
              From {draft.provider_name} ({processingLabel(draft.processing)}).
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => suggest.mutate(focus.trim())}
              disabled={suggest.isPending || saving}
            >
              <RotateCcw aria-hidden="true" />
              Try again
            </Button>
          </div>
        </section>
      ) : null}
      <FormAlert message={error} />
    </DialogShell>
  );
}
