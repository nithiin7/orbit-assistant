"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type {
  Agent,
  AgentMemory,
  AgentModule,
  AgentRuntime,
  AgentTool,
  AgentTriggerKind,
} from "@orbit/contracts";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { type Control, Controller, type FieldPath, useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useAgentMemories,
  useAgentTools,
  useMemoryActions,
  useUpdateAgent,
} from "@/hooks/use-agent";
import {
  AGENT_MODULES,
  agentSettingsRequest,
  agentSettingsSchema,
  type AgentSettingsValues,
  agentSettingsValues,
  AUTONOMY_LEVELS,
  memorySchema,
  MODULE_LABELS,
  MONITOR_CATEGORIES,
  MONITOR_FREQUENCY_LABELS,
  MONITOR_LABELS,
  MONITOR_MODULE,
  SENSITIVE_MODULES,
  TRIGGER_LABELS,
} from "@/lib/agent";
import { cn } from "@/utils/common";

import { ErrorNote, LoadingRows, RuntimeNote, SectionHeading } from "./shared";

const AUTO_TRIGGERS: readonly AgentTriggerKind[] = ["manual", "schedule", "event", "condition"];
const MODE_OPTIONS = [
  { value: "", label: "Default (ask)" },
  { value: "ask", label: "Always ask" },
  { value: "auto", label: "Allow automatically" },
  { value: "off", label: "Off" },
];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-xl border bg-card p-5">
      <legend className="sr-only">{title}</legend>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </fieldset>
  );
}

function Subgroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

type BoolPath = FieldPath<AgentSettingsValues>;

function Toggle({
  control,
  name,
  label,
  hint,
}: {
  control: Control<AgentSettingsValues>;
  name: BoolPath;
  label: string;
  hint?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <label className="flex items-start justify-between gap-3 text-sm">
          <span>
            <span className="font-medium">{label}</span>
            {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
          </span>
          <Switch
            checked={field.value === true}
            onCheckedChange={field.onChange}
            aria-label={label}
          />
        </label>
      )}
    />
  );
}

function Checklist<T extends string>({
  values,
  options,
  onChange,
  label,
}: {
  values: readonly T[];
  options: readonly { value: T; label: string; note?: string }[];
  onChange: (next: T[]) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={values.includes(option.value)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...values, option.value]
                  : values.filter((value) => value !== option.value),
              )
            }
          />
          {option.label}
          {option.note ? (
            <span className="text-xs text-muted-foreground">{option.note}</span>
          ) : null}
        </label>
      ))}
    </div>
  );
}

/** Everything the agent may do, set only by you. */
export function AgentSettings({ agent, runtime }: { agent: Agent; runtime: AgentRuntime }) {
  const tools = useAgentTools();
  return (
    <div className="space-y-8">
      <SettingsForm
        key={agent.updated_at}
        agent={agent}
        tools={tools.status === "success" ? tools.data.tools : []}
      />
      <MemorySection />
      <RuntimeNote runtime={runtime} />
    </div>
  );
}

function SettingsForm({ agent, tools }: { agent: Agent; tools: readonly AgentTool[] }) {
  const id = useId();
  const update = useUpdateAgent();
  const [saved, setSaved] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AgentSettingsValues>({
    resolver: yupResolver(agentSettingsSchema),
    defaultValues: agentSettingsValues(agent),
  });
  const modules = useWatch({ control, name: "modules" });
  const autonomy = useWatch({ control, name: "autonomy" });
  const monitoring = useWatch({ control, name: "monitoring.enabled" });

  async function save(values: AgentSettingsValues) {
    setSaved(false);
    try {
      await update.mutateAsync(agentSettingsRequest(values));
      setSaved(true);
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save. Try again.") });
    }
  }

  const writes = tools.filter((tool) => tool.access !== "read");

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(save)(event)} className="space-y-4">
      <SectionHeading title="Settings" />
      <Group title="How much it can do">
        <Controller
          control={control}
          name="autonomy"
          render={({ field }) => (
            <div
              role="radiogroup"
              aria-label="Autonomy level"
              className="grid gap-2 @2xl:grid-cols-2"
            >
              {AUTONOMY_LEVELS.map((level) => (
                <label
                  key={level.value}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-lg border p-3 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring",
                    field.value === level.value && "border-brand bg-brand-subtle/40",
                  )}
                >
                  <input
                    type="radio"
                    name={`${id}-autonomy`}
                    value={level.value}
                    checked={field.value === level.value}
                    onChange={() => field.onChange(level.value)}
                    className="mt-1 accent-brand"
                  />
                  <span>
                    <span className="font-medium">{level.label}</span>
                    <span className="block text-xs text-muted-foreground">{level.description}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        />
        {autonomy === "limited" ? (
          <Controller
            control={control}
            name="autonomousTriggers"
            render={({ field }) => (
              <div className="space-y-2 border-t pt-3">
                <p className="text-sm font-medium">Acts on its own in</p>
                <Checklist
                  label="Acts on its own in"
                  values={field.value}
                  onChange={field.onChange}
                  options={AUTO_TRIGGERS.map((trigger) => ({
                    value: trigger,
                    label: TRIGGER_LABELS[trigger],
                  }))}
                />
              </div>
            )}
          />
        ) : null}
      </Group>

      <Group title="What it can use">
        <Controller
          control={control}
          name="modules"
          render={({ field }) => (
            <Checklist<AgentModule>
              label="Modules"
              values={field.value}
              onChange={field.onChange}
              options={AGENT_MODULES.map((module) => ({
                value: module,
                label: MODULE_LABELS[module],
                note: SENSITIVE_MODULES.has(module) ? "sensitive" : undefined,
              }))}
            />
          )}
        />
        <div className="space-y-2 border-t pt-3">
          <Toggle control={control} name="canCreate" label="Create records" />
          <Toggle control={control} name="canUpdate" label="Change records" />
          <p className="text-xs text-muted-foreground">
            It can never delete, pay, send, or share anything.
          </p>
        </div>
      </Group>

      <Group title="Instructions">
        <FormField
          label="Name"
          autoComplete="off"
          {...register("name")}
          error={errors.name?.message}
        />
        <div className="space-y-1.5">
          <label htmlFor={`${id}-instructions`} className="block text-sm font-medium">
            Instructions <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={`${id}-instructions`}
            rows={3}
            placeholder="Keep summaries short. Work tasks come first on weekdays."
            {...register("instructions")}
          />
          {errors.instructions ? (
            <p className="text-xs text-destructive">{errors.instructions.message}</p>
          ) : null}
        </div>
      </Group>

      <Group title="Notify me about">
        <Toggle control={control} name="notifications.approvals" label="Approval requests" />
        <Toggle control={control} name="notifications.failed" label="Failed runs" />
        <Toggle control={control} name="notifications.completed" label="Completed runs" />
        <Toggle control={control} name="notifications.insights" label="Monitoring findings" />
      </Group>

      <Group title="Monitoring">
        <Toggle
          control={control}
          name="monitoring.enabled"
          label="Watch for things that need attention"
          hint="Regular checks without AI. Findings arrive as notifications."
        />
        {monitoring ? (
          <div className="space-y-3 border-t pt-3">
            <Controller
              control={control}
              name="monitoring.categories"
              render={({ field }) => (
                <Checklist
                  label="What to watch"
                  values={field.value}
                  onChange={field.onChange}
                  options={MONITOR_CATEGORIES.map((category) => ({
                    value: category,
                    label: MONITOR_LABELS[category],
                    note: modules.includes(MONITOR_MODULE[category])
                      ? undefined
                      : `needs ${MODULE_LABELS[MONITOR_MODULE[category]]}`,
                  }))}
                />
              )}
            />
            <div className="grid gap-3 @2xl:grid-cols-2">
              <SelectField
                control={control}
                name="monitoring.frequency"
                label="How often"
                options={Object.entries(MONITOR_FREQUENCY_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              <FormField
                label="Look ahead (days)"
                type="number"
                {...register("monitoring.days_ahead", { valueAsNumber: true })}
                error={errors.monitoring?.days_ahead?.message}
              />
              <FormField
                label="Documents expiring within (days)"
                type="number"
                {...register("monitoring.document_days", { valueAsNumber: true })}
                error={errors.monitoring?.document_days?.message}
              />
              <FormField
                label="Budget warning at (%)"
                type="number"
                {...register("monitoring.budget_percent", { valueAsNumber: true })}
                error={errors.monitoring?.budget_percent?.message}
              />
            </div>
          </div>
        ) : null}
      </Group>

      <details className="group rounded-xl border bg-card">
        <summary className="flex cursor-pointer items-center justify-between gap-2 rounded-xl px-5 py-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          Advanced
          <ChevronDown
            className="size-4 text-muted-foreground transition-transform duration-150 group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="space-y-6 border-t px-5 py-5">
          <Subgroup title="Each action">
            <Controller
              control={control}
              name="toolModes"
              render={({ field }) => (
                <ul className="divide-y">
                  {writes.map((tool) => (
                    <li
                      key={tool.name}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span className="min-w-0 text-sm">
                        <span className="font-medium">{tool.title}</span>
                        {tool.module && !modules.includes(tool.module) ? (
                          <span className="block text-xs text-muted-foreground">
                            Needs {MODULE_LABELS[tool.module]}
                          </span>
                        ) : null}
                      </span>
                      <Select
                        className="w-52"
                        aria-label={`${tool.title} setting`}
                        value={field.value[tool.name] ?? ""}
                        onValueChange={(mode) =>
                          field.onChange({ ...field.value, [tool.name]: mode })
                        }
                        options={
                          tool.approval === "always" || tool.risk !== "low"
                            ? MODE_OPTIONS.filter((option) => option.value !== "auto")
                            : MODE_OPTIONS
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            />
          </Subgroup>

          <Subgroup title="Limits">
            <div className="grid gap-3 @2xl:grid-cols-2">
              {(
                [
                  ["max_steps", "Steps per run"],
                  ["max_tool_calls", "Tool calls per run"],
                  ["timeout_seconds", "Time per run (seconds)"],
                  ["max_tokens_per_run", "AI tokens per run"],
                  ["max_runs_per_day", "Runs per day"],
                  ["max_autonomous_actions_per_day", "Automatic actions per day"],
                  ["approval_ttl_hours", "Approvals expire after (hours)"],
                  ["max_retries", "Retries of a failing step"],
                ] as const
              ).map(([name, label]) => (
                <FormField
                  key={name}
                  label={label}
                  type="number"
                  {...register(`limits.${name}`, { valueAsNumber: true })}
                  error={errors.limits?.[name]?.message}
                />
              ))}
            </div>
          </Subgroup>

          <Subgroup title="Memory">
            <Toggle control={control} name="memory.preferences" label="Saved preferences" />
            <Toggle control={control} name="memory.conversation" label="Recent runs" />
            <Toggle control={control} name="memory.workflow" label="Workflow results" />
            <FormField
              label="Keep history for (days)"
              type="number"
              {...register("memory.retention_days", { valueAsNumber: true })}
              error={errors.memory?.retention_days?.message}
            />
          </Subgroup>

          <Subgroup title="AI model">
            <FormField
              label="Model"
              hint="Leave empty to use the one in Settings → AI."
              autoComplete="off"
              {...register("chatModel")}
              error={errors.chatModel?.message}
            />
          </Subgroup>
        </div>
      </details>

      <FormAlert message={errors.root?.server?.message ?? null} />
      <div className="sticky bottom-4 flex items-center gap-3">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? "Saving…" : "Save settings"}
        </Button>
        {saved && !isDirty ? (
          <p role="status" className="text-sm text-muted-foreground">
            Saved.
          </p>
        ) : null}
      </div>
    </form>
  );
}

function MemorySection() {
  const memories = useAgentMemories();
  const { add } = useMemoryActions();
  const id = useId();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: yupResolver(memorySchema), defaultValues: { content: "" } });

  async function submit({ content }: InferType<typeof memorySchema>) {
    try {
      await add.mutateAsync(content);
      reset();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save it.") });
    }
  }

  return (
    <section className="space-y-3">
      <SectionHeading title="What it remembers" />
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(submit)(event)}
        className="flex gap-2"
      >
        <label htmlFor={`${id}-memory`} className="sr-only">
          New preference
        </label>
        <Input
          id={`${id}-memory`}
          placeholder="I prefer meetings after 10:00."
          aria-invalid={Boolean(errors.content)}
          {...register("content")}
        />
        <Button type="submit" variant="soft" disabled={isSubmitting}>
          Add
        </Button>
      </form>
      {errors.content ? <p className="text-xs text-destructive">{errors.content.message}</p> : null}
      <FormAlert message={errors.root?.server?.message ?? null} />
      {memories.status === "loading" ? (
        <LoadingRows label="Loading memories" rows={2} />
      ) : memories.status === "error" ? (
        <ErrorNote message={memories.message} />
      ) : memories.data.memories.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing saved.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {memories.data.memories.map((memory) => (
            <MemoryRow key={memory.id} memory={memory} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MemoryRow({ memory }: { memory: AgentMemory }) {
  const { update, remove } = useMemoryActions();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.content);
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="space-y-1 px-3 py-2.5">
      <div className="flex items-center gap-2">
        {editing ? (
          <Input
            aria-label="Memory"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="h-8"
          />
        ) : (
          <p className="flex-1 text-sm">{memory.content}</p>
        )}
        <Badge>
          {memory.category === "workflow"
            ? "Workflow"
            : memory.source === "user"
              ? "You"
              : "Approved"}
        </Badge>
        {editing ? (
          <Button
            size="sm"
            variant="soft"
            onClick={() =>
              update.mutate(
                { id: memory.id, content: text.trim() },
                {
                  onSuccess: () => setEditing(false),
                  onError: (cause) => setError(describeApiError(cause, "Couldn’t save it.")),
                },
              )
            }
          >
            Save
          </Button>
        ) : memory.category === "preference" ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Edit memory"
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden="true" />
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="Delete memory"
          onClick={() =>
            remove.mutate(memory.id, {
              onError: (cause) => setError(describeApiError(cause, "Couldn’t delete it.")),
            })
          }
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </li>
  );
}
