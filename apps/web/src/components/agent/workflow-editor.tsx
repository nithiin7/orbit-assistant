"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { AgentStepKind, AgentTool } from "@orbit/contracts";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  GitBranch,
  Hand,
  Plus,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import { useId } from "react";
import { type Control, Controller, useFieldArray, useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { DialogShell } from "@/components/finance/dialog-shell";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  argumentFields,
  COMPARE_LABELS,
  EVENT_LABELS,
  FREQUENCY_LABELS,
  METRIC_LABELS,
  newStep,
  NUMERIC_OPS,
  STEP_KIND_LABELS,
  STEP_KINDS,
  WEEKDAYS,
  type WorkflowFormValues,
  workflowSchema,
} from "@/lib/agent";
import { timeZoneLabel, timeZoneNames } from "@/utils/time-zones";

type WorkflowEditorProps = {
  title: string;
  initial: WorkflowFormValues;
  tools: readonly AgentTool[];
  onSave: (values: WorkflowFormValues) => Promise<unknown>;
  onClose: () => void;
};

const TRIGGER_OPTIONS = [
  { value: "manual", label: "When I run it" },
  { value: "schedule", label: "On a schedule" },
  { value: "event", label: "When something happens" },
  { value: "condition", label: "When a number crosses a limit" },
];

const STEP_ICONS: Record<AgentStepKind, typeof Wrench> = {
  tool: Wrench,
  condition: GitBranch,
  delay: Clock,
  approval: Hand,
  ai: Sparkles,
};

function options(labels: Record<string, string>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

/** Create or edit a workflow: a trigger, then steps run in order by Orbit. */
export function WorkflowEditor({ title, initial, tools, onSave, onClose }: WorkflowEditorProps) {
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<WorkflowFormValues>({
    resolver: yupResolver(workflowSchema),
    defaultValues: initial,
  });
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "steps",
    keyName: "key",
  });
  const triggerKind = useWatch({ control, name: "triggerKind" });
  const frequency = useWatch({ control, name: "frequency" });
  const event = useWatch({ control, name: "event" });
  const steps = useWatch({ control, name: "steps" });
  const zoneOptions = timeZoneNames(initial.timezone).map((zone) => ({
    value: zone,
    label: timeZoneLabel(zone),
  }));
  const usable = tools.filter((tool) => tool.in_workflows);

  async function save(values: WorkflowFormValues, close: () => void) {
    try {
      await onSave(values);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the workflow. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title={title}
      description="Choose when it starts, then what it does."
      busy={saving}
      onClose={onClose}
      onSubmit={(formEvent, close) => void handleSubmit((values) => save(values, close))(formEvent)}
      submitLabel="Save workflow"
      wide
    >
      <FormField
        label="Name"
        autoComplete="off"
        autoFocus
        placeholder="Morning briefing"
        {...register("name")}
        error={errors.name?.message}
      />

      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">When</legend>
        <SelectField
          control={control}
          name="triggerKind"
          label="Starts"
          options={TRIGGER_OPTIONS}
        />
        {triggerKind === "schedule" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              control={control}
              name="frequency"
              label="Repeat"
              options={options(FREQUENCY_LABELS)}
            />
            <FormField
              label="Time"
              placeholder="08:00"
              {...register("time")}
              error={errors.time?.message}
            />
            <SelectField
              control={control}
              name="timezone"
              label="Time zone"
              options={zoneOptions}
            />
            {frequency === "monthly" ? (
              <FormField
                label="Day of the month"
                type="number"
                min={1}
                max={31}
                {...register("dayOfMonth", { valueAsNumber: true })}
                error={errors.dayOfMonth?.message}
              />
            ) : null}
            {frequency === "once" ? (
              <FormField
                label="Date"
                type="text"
                placeholder="YYYY-MM-DD"
                {...register("onDate")}
                error={errors.onDate?.message}
              />
            ) : null}
            {frequency === "weekly" ? (
              <Controller
                control={control}
                name="weekdays"
                render={({ field, fieldState }) => (
                  <fieldset className="space-y-1.5 sm:col-span-2">
                    <legend className="text-sm font-medium">Days</legend>
                    <div className="flex flex-wrap gap-3">
                      {WEEKDAYS.map((day, index) => (
                        <label key={day} className="flex items-center gap-1.5 text-sm">
                          <Checkbox
                            checked={field.value.includes(index)}
                            onChange={(change) =>
                              field.onChange(
                                change.target.checked
                                  ? [...field.value, index].sort()
                                  : field.value.filter((d) => d !== index),
                              )
                            }
                          />
                          {day}
                        </label>
                      ))}
                    </div>
                    {fieldState.error ? (
                      <p className="text-xs text-destructive">{fieldState.error.message}</p>
                    ) : null}
                  </fieldset>
                )}
              />
            ) : null}
          </div>
        ) : null}
        {triggerKind === "event" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              control={control}
              name="event"
              label="When"
              options={options(EVENT_LABELS)}
            />
            {event === "event_approaching" ? (
              <FormField
                label="Minutes before"
                type="number"
                {...register("leadMinutes", { valueAsNumber: true })}
                error={errors.leadMinutes?.message}
              />
            ) : null}
            {event === "document_expiring" ? (
              <FormField
                label="Days before expiry"
                type="number"
                {...register("daysAhead", { valueAsNumber: true })}
                error={errors.daysAhead?.message}
              />
            ) : null}
          </div>
        ) : null}
        {triggerKind === "condition" ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              control={control}
              name="metric"
              label="Metric"
              options={options(METRIC_LABELS)}
            />
            <SelectField
              control={control}
              name="metricOp"
              label="Is"
              options={NUMERIC_OPS.map((op) => ({ value: op, label: COMPARE_LABELS[op] }))}
            />
            <FormField
              label="Value"
              type="number"
              {...register("metricValue", { valueAsNumber: true })}
              error={errors.metricValue?.message}
            />
            <FormField
              label="Check every (minutes)"
              type="number"
              {...register("checkMinutes", { valueAsNumber: true })}
              error={errors.checkMinutes?.message}
            />
            <FormField
              label="Look ahead (days)"
              type="number"
              {...register("daysAhead", { valueAsNumber: true })}
              error={errors.daysAhead?.message}
            />
          </div>
        ) : null}
      </fieldset>

      <fieldset className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <legend className="text-sm font-medium">Then</legend>
          <Menu
            size="sm"
            variant="soft"
            items={STEP_KINDS.map((kind) => ({
              id: kind,
              label: STEP_KIND_LABELS[kind],
              icon: STEP_ICONS[kind],
              onSelect: () =>
                append(
                  newStep(
                    kind,
                    steps.map((s) => s.id),
                  ),
                ),
            }))}
          >
            <Plus aria-hidden="true" />
            Add step
          </Menu>
        </div>
        {errors.steps?.message ? (
          <p className="text-xs text-destructive">{errors.steps.message}</p>
        ) : fields.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            Pass results along with {"{{steps.<id>.text}}"} or {"{{trigger.title}}"}.
          </p>
        ) : null}
        <ol className="space-y-3">
          {fields.map((field, index) => {
            const step = steps[index];
            if (!step) return null;
            const Icon = STEP_ICONS[step.kind];
            const later = steps
              .slice(index + 1)
              .map((s) => ({ value: s.id, label: s.title || s.id }));
            return (
              <li key={field.key} className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                    {index + 1}. {STEP_KIND_LABELS[step.kind]}
                    <span
                      className="rounded bg-muted px-1.5 font-mono text-xs font-normal text-muted-foreground"
                      title={`Later steps can use {{steps.${step.id}.text}}`}
                    >
                      steps.{step.id}
                    </span>
                  </p>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`Move step ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`Move step ${index + 1} down`}
                      disabled={index === fields.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`Remove step ${index + 1}`}
                      onClick={() => remove(index)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <FormField
                  label="Step name"
                  placeholder={STEP_KIND_LABELS[step.kind]}
                  autoComplete="off"
                  {...register(`steps.${index}.title`)}
                />
                {step.kind === "tool" ? (
                  <ToolStep
                    control={control}
                    index={index}
                    tools={usable}
                    tool={step.tool}
                    id={id}
                  />
                ) : null}
                {step.kind === "condition" ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <FormField
                      label="Value"
                      placeholder="steps.find.count or trigger.title"
                      {...register(`steps.${index}.conditionLeft`)}
                      error={errors.steps?.[index]?.conditionLeft?.message}
                    />
                    <SelectField
                      control={control}
                      name={`steps.${index}.conditionOp`}
                      label="Is"
                      options={options(COMPARE_LABELS)}
                    />
                    <FormField
                      label="Compared with"
                      {...register(`steps.${index}.conditionRight`)}
                    />
                    <div className="sm:col-span-3">
                      <SelectField
                        control={control}
                        name={`steps.${index}.onFalse`}
                        label="Otherwise"
                        options={[
                          { value: "end", label: "Stop the workflow" },
                          ...later.map((s) => ({ ...s, label: `Skip to ${s.label}` })),
                        ]}
                      />
                    </div>
                  </div>
                ) : null}
                {step.kind === "delay" ? (
                  <FormField
                    label="Wait (minutes)"
                    type="number"
                    {...register(`steps.${index}.minutes`, { valueAsNumber: true })}
                    error={errors.steps?.[index]?.minutes?.message}
                  />
                ) : null}
                {step.kind === "approval" || step.kind === "ai" ? (
                  <div className="space-y-1.5">
                    <label htmlFor={`${id}-prompt-${index}`} className="block text-sm font-medium">
                      {step.kind === "ai" ? "Instruction" : "Message for you"}
                    </label>
                    <Textarea
                      id={`${id}-prompt-${index}`}
                      rows={3}
                      placeholder={
                        step.kind === "ai"
                          ? "Summarize {{steps.tasks.text}} in three bullet points."
                          : "Go ahead with the rest?"
                      }
                      aria-invalid={Boolean(errors.steps?.[index]?.prompt)}
                      {...register(`steps.${index}.prompt`)}
                    />
                    {errors.steps?.[index]?.prompt ? (
                      <p className="text-xs text-destructive">
                        {errors.steps[index].prompt.message}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </fieldset>
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

function ToolStep({
  control,
  index,
  tools,
  tool,
  id,
}: {
  control: Control<WorkflowFormValues>;
  index: number;
  tools: readonly AgentTool[];
  tool: string;
  id: string;
}) {
  const selected = tools.find((t) => t.name === tool);
  const fields = argumentFields(selected);
  return (
    <div className="space-y-3">
      <SelectField
        control={control}
        name={`steps.${index}.tool`}
        label="Action"
        placeholder="Choose an action"
        options={tools.map((t) => ({
          value: t.name,
          label: t.access === "read" ? t.title : `${t.title} (makes a change)`,
        }))}
      />
      {selected ? <p className="text-xs text-muted-foreground">{selected.description}</p> : null}
      {fields.length ? (
        <Controller
          control={control}
          name={`steps.${index}.arguments`}
          render={({ field }) => (
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((argument) => {
                const inputId = `${id}-arg-${index}-${argument.name}`;
                const current = field.value[argument.name] ?? "";
                const set = (next: string) =>
                  field.onChange({ ...field.value, [argument.name]: next });
                return (
                  <div key={argument.name} className="space-y-1.5">
                    <label htmlFor={inputId} className="block text-sm font-medium capitalize">
                      {argument.label}
                      {argument.required ? null : (
                        <span className="font-normal text-muted-foreground normal-case">
                          {" "}
                          (optional)
                        </span>
                      )}
                    </label>
                    {argument.kind === "boolean" || argument.kind === "choice" ? (
                      <Select
                        id={inputId}
                        value={current}
                        onValueChange={set}
                        placeholder="Not set"
                        options={[
                          { value: "", label: "Not set" },
                          ...(argument.kind === "boolean"
                            ? [
                                { value: "true", label: "Yes" },
                                { value: "false", label: "No" },
                              ]
                            : argument.options.map((option) => ({ value: option, label: option }))),
                        ]}
                      />
                    ) : (
                      <Input
                        id={inputId}
                        value={current}
                        onChange={(e) => set(e.target.value)}
                        autoComplete="off"
                      />
                    )}
                    {argument.description ? (
                      <p className="text-xs text-muted-foreground">{argument.description}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        />
      ) : null}
    </div>
  );
}
