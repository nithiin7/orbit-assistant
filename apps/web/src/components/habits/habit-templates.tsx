"use client";

import type { HabitColor, HabitIcon } from "@orbit/contracts";
import { Check, Plus } from "lucide-react";
import { useState } from "react";

import {
  describeHabitTemplate,
  describeRoutineTemplate,
  HABIT_TEMPLATES,
  type HabitTemplate,
  ROUTINE_TEMPLATES,
  type RoutineTemplate,
  TEMPLATE_FILTERS,
  type TemplateFilter,
} from "@/lib/habits";
import { cn } from "@/utils/common";

import { HabitTile } from "./habit-icon";

const FILTERS: readonly { value: TemplateFilter | "all"; label: string }[] = [
  { value: "all", label: "All" },
  ...TEMPLATE_FILTERS,
];

/**
 * Ready-made habits and routines. Choosing one opens the New habit or New routine form filled
 * in, so it can be adjusted before it's created.
 */
export function HabitTemplatesView({
  existingNames,
  onUseHabit,
  onUseRoutine,
}: {
  /** Names already in use, lowercased, so matching templates say so. */
  existingNames: ReadonlySet<string>;
  onUseHabit: (template: HabitTemplate) => void;
  onUseRoutine: (template: RoutineTemplate) => void;
}) {
  const [filter, setFilter] = useState<TemplateFilter | "all">("all");
  const habits = HABIT_TEMPLATES.filter(
    (template) => filter === "all" || template.category === filter,
  );
  const showRoutines = filter === "all" || filter === "routines";

  return (
    <div className="space-y-6">
      <p className="max-w-prose text-sm text-muted-foreground">
        Pick one to start from. You can change the name, target, schedule, and reminders before it’s
        added.
      </p>
      <div
        role="group"
        aria-label="Template categories"
        className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto px-1"
      >
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={cn(
              "h-8 shrink-0 rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === option.value
                ? "bg-brand-subtle text-brand"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {habits.length > 0 ? (
        <section aria-labelledby="habit-templates-heading" className="space-y-3">
          <h2 id="habit-templates-heading" className="text-sm font-semibold">
            Habits
          </h2>
          <ul className="grid gap-3 @2xl:grid-cols-2 @6xl:grid-cols-3">
            {habits.map((template) => (
              <li key={template.id}>
                <TemplateCard
                  name={template.fields.name}
                  icon={template.fields.icon}
                  color={template.fields.color}
                  blurb={template.blurb}
                  meta={describeHabitTemplate(template)}
                  inUse={existingNames.has(template.fields.name.toLocaleLowerCase())}
                  onUse={() => onUseHabit(template)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showRoutines ? (
        <section aria-labelledby="routine-templates-heading" className="space-y-3">
          <div>
            <h2 id="routine-templates-heading" className="text-sm font-semibold">
              Routines
            </h2>
            <p className="text-xs text-muted-foreground">
              A few steps run through in order, like a checklist.
            </p>
          </div>
          <ul className="grid gap-3 @2xl:grid-cols-2 @6xl:grid-cols-3">
            {ROUTINE_TEMPLATES.map((template) => (
              <li key={template.id}>
                <TemplateCard
                  name={template.name}
                  icon={template.icon}
                  color={template.color}
                  blurb={template.blurb}
                  meta={describeRoutineTemplate(template)}
                  steps={template.steps.map((step) => step.name)}
                  inUse={existingNames.has(template.name.toLocaleLowerCase())}
                  onUse={() => onUseRoutine(template)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function TemplateCard({
  name,
  icon,
  color,
  blurb,
  meta,
  steps,
  inUse,
  onUse,
}: {
  name: string;
  icon: HabitIcon;
  color: HabitColor;
  blurb: string;
  meta: string;
  steps?: readonly string[];
  inUse: boolean;
  onUse: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onUse}
      aria-label={`Use the “${name}” template${inUse ? ", already tracking" : ""}`}
      className="group/template flex h-full w-full flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-[background-color,border-color,translate,box-shadow] duration-150 outline-none hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-elevation-2 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
    >
      <span className="flex items-start gap-3">
        <HabitTile icon={icon} color={color} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{name}</span>
          <span className="block text-xs text-muted-foreground">{meta}</span>
        </span>
      </span>
      <span className="text-sm text-pretty text-muted-foreground">{blurb}</span>
      {steps ? (
        <ol className="space-y-1 text-xs text-muted-foreground">
          {steps.map((step, index) => (
            <li key={step} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[0.625rem] font-medium tabular-nums"
              >
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      ) : null}
      <span className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs">
        {inUse ? (
          <span className="flex items-center gap-1 text-success">
            <Check className="size-3.5" aria-hidden="true" />
            Already tracking
          </span>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-1 font-medium text-brand">
          <Plus className="size-3.5" aria-hidden="true" />
          Use template
        </span>
      </span>
    </button>
  );
}
