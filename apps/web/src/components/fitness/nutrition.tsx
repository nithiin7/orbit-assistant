"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Food, FoodEntry, MealType, SavedMeal } from "@orbit/contracts";
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";
import { Controller, useForm, type UseFormRegisterReturn, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import {
  deleteFood,
  deleteFoodEntry,
  deleteMeal,
  logMeal,
  saveFood,
  saveFoodEntry,
  saveMeal,
} from "@/api/fitness";
import { useConfirm } from "@/components/confirm-dialog";
import { DialogShell } from "@/components/finance/dialog-shell";
import { DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Menu } from "@/components/ui/menu";
import {
  useFitnessAction,
  useFoods,
  useMeals,
  useNutritionDay,
  useNutritionHistory,
  useUnits,
} from "@/hooks/use-fitness";
import {
  energyInput,
  type EntryFormValues,
  entrySchema,
  type FoodFormValues,
  foodSchema,
  formatEnergy,
  formatGrams,
  formatQuantity,
  gramsInput,
  MEALS,
  newEntryValues,
  newFoodValues,
  parseQuantity,
  quantityInput,
  share,
  toFoodFormValues,
  toFoodRequest,
  toPortionRequest,
  type Units,
} from "@/lib/fitness";
import { addDays } from "@/utils/dates";

import { BarChart, Loaded, Meter, Section, shortDate } from "./shared";

export function NutritionView({ workspaceId, today }: { workspaceId: string; today: string }) {
  const units = useUnits(workspaceId);
  const [day, setDay] = useState(today);
  const nutrition = useNutritionDay(workspaceId, day);
  const run = useFitnessAction(workspaceId);
  const { confirm, confirmDialog } = useConfirm();
  const [adding, setAdding] = useState<{ meal: MealType; entry: FoodEntry | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = (call: (token: string) => Promise<unknown>) => {
    setError(null);
    run(call).catch((reason: unknown) => setError(describeApiError(reason, "Couldn’t save that.")));
  };

  async function remove(entry: FoodEntry) {
    const ok = await confirm({
      title: `Delete ${entry.portion.name}?`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) act((token) => deleteFoodEntry(token, workspaceId, entry.id));
  }

  function saveAsMeal(meal: MealType, entries: FoodEntry[]) {
    const name = `${MEALS.find((m) => m.value === meal)?.label ?? "Meal"} (${shortDate(day)})`;
    act((token) =>
      saveMeal(token, workspaceId, null, {
        name,
        items: entries.map((e) => ({
          quantity_milli: e.portion.quantity_milli,
          food_id: null,
          name: e.portion.name,
          serving_unit: e.portion.serving_unit,
          nutrients: e.portion.nutrients,
        })),
      }),
    );
  }

  return (
    <div className="space-y-4">
      <DayNavigator day={day} today={today} onChange={setDay} />
      <FormAlert message={error} />
      <Loaded resource={nutrition.state} reload={nutrition.reload} skeleton="h-64">
        {(data) => (
          <div className="grid gap-4 @4xl:grid-cols-[1fr_20rem]">
            <div className="space-y-3">
              {MEALS.map((meal) => {
                const entries = data.entries.filter((e) => e.meal === meal.value);
                const totals = data.by_meal[meal.value];
                return (
                  <Section
                    key={meal.value}
                    title={meal.label}
                    description={
                      totals && entries.length > 0
                        ? `${formatEnergy(totals.energy_cal, units.energy_unit)} · ${formatGrams(totals.protein_mg)} protein`
                        : undefined
                    }
                    action={
                      <div className="flex gap-1">
                        {entries.length > 0 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => saveAsMeal(meal.value, entries)}
                          >
                            <Save aria-hidden="true" />
                            Save as meal
                          </Button>
                        ) : null}
                        <Button
                          variant="soft"
                          size="sm"
                          onClick={() => setAdding({ meal: meal.value, entry: null })}
                          aria-label={`Add food to ${meal.label}`}
                        >
                          <Plus aria-hidden="true" />
                          Add
                        </Button>
                      </div>
                    }
                  >
                    {entries.length === 0 ? null : (
                      <ul className="divide-y">
                        {entries.map((entry) => (
                          <li
                            key={entry.id}
                            className="flex items-center justify-between gap-2 py-1.5"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm">{entry.portion.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatQuantity(entry.portion.quantity_milli)}{" "}
                                {entry.portion.serving_unit} ·{" "}
                                {formatEnergy(
                                  entry.portion.nutrients.energy_cal,
                                  units.energy_unit,
                                )}
                              </p>
                            </div>
                            <Menu
                              variant="ghost"
                              size="icon"
                              chevron={false}
                              align="end"
                              aria-label={`Actions for ${entry.portion.name}`}
                              items={[
                                {
                                  id: "edit",
                                  label: "Edit",
                                  icon: Pencil,
                                  onSelect: () => setAdding({ meal: entry.meal, entry }),
                                },
                                {
                                  id: "delete",
                                  label: "Delete",
                                  icon: Trash2,
                                  destructive: true,
                                  onSelect: () => void remove(entry),
                                },
                              ]}
                            >
                              <MoreHorizontal aria-hidden="true" />
                            </Menu>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>
                );
              })}
            </div>
            <div className="space-y-4">
              <Section title="Totals" description={day === today ? "Today" : shortDate(day)}>
                <div className="space-y-3">
                  <Meter
                    label="Energy"
                    value={`${formatEnergy(data.totals.energy_cal, units.energy_unit)}${data.targets.energy_cal ? ` of ${formatEnergy(data.targets.energy_cal, units.energy_unit)}` : ""}`}
                    fraction={share(data.totals.energy_cal, data.targets.energy_cal)}
                  />
                  {(
                    [
                      ["Protein", "protein_mg"],
                      ["Carbohydrates", "carbs_mg"],
                      ["Fat", "fat_mg"],
                      ["Fiber", "fiber_mg"],
                    ] as const
                  ).map(([label, key]) => {
                    const value = data.totals[key] ?? 0;
                    const target = data.targets[key];
                    return (
                      <Meter
                        key={key}
                        label={label}
                        tone="chart"
                        value={`${formatGrams(value)}${target ? ` of ${formatGrams(target)}` : ""}`}
                        fraction={share(value, target)}
                      />
                    );
                  })}
                </div>
                {!data.targets.energy_cal ? (
                  <p className="text-xs text-muted-foreground">Set daily targets in Settings.</p>
                ) : null}
              </Section>
              <SavedMeals
                workspaceId={workspaceId}
                day={day}
                units={units}
                act={act}
                confirm={confirm}
              />
              <NutritionHistory workspaceId={workspaceId} today={today} units={units} />
            </div>
          </div>
        )}
      </Loaded>
      <SavedFoods workspaceId={workspaceId} units={units} act={act} confirm={confirm} />
      {adding ? (
        <FoodEntryDialog
          workspaceId={workspaceId}
          day={day}
          meal={adding.meal}
          editing={adding.entry}
          units={units}
          onClose={() => setAdding(null)}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

export function DayNavigator({
  day,
  today,
  onChange,
}: {
  day: string;
  today: string;
  onChange: (day: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous day"
        onClick={() => onChange(addDays(day, -1))}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <DatePicker
        aria-label="Day"
        value={day}
        onValueChange={(value) => value && onChange(value)}
        className="w-48"
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Next day"
        disabled={day >= today}
        onClick={() => onChange(addDays(day, 1))}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
      {day !== today ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(today)}>
          Today
        </Button>
      ) : null}
    </div>
  );
}

type Act = (call: (token: string) => Promise<unknown>) => void;
type Confirm = ReturnType<typeof useConfirm>["confirm"];

function SavedMeals({
  workspaceId,
  day,
  units,
  act,
  confirm,
}: {
  workspaceId: string;
  day: string;
  units: Units;
  act: Act;
  confirm: Confirm;
}) {
  const meals = useMeals(workspaceId);
  async function remove(meal: SavedMeal) {
    const ok = await confirm({
      title: `Delete ${meal.name}?`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) act((token) => deleteMeal(token, workspaceId, meal.id));
  }
  return (
    <Section title="Saved meals" description="Log several foods at once.">
      <Loaded resource={meals.state} reload={meals.reload} skeleton="h-16">
        {({ meals: list }) =>
          list.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Use “Save as meal” on a meal you eat often.
            </p>
          ) : (
            <ul className="space-y-2">
              {list.map((meal) => (
                <li key={meal.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{meal.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {meal.items.length} items ·{" "}
                      {formatEnergy(meal.totals.energy_cal, units.energy_unit)}
                    </p>
                  </div>
                  <Menu
                    variant="soft"
                    size="sm"
                    align="end"
                    aria-label={`Log ${meal.name}`}
                    items={[
                      ...MEALS.map((option) => ({
                        id: option.value,
                        label: `Log to ${option.label}`,
                        onSelect: () =>
                          act((token) => logMeal(token, workspaceId, meal.id, day, option.value)),
                      })),
                      {
                        id: "delete",
                        label: "Delete meal",
                        icon: Trash2,
                        destructive: true,
                        onSelect: () => void remove(meal),
                      },
                    ]}
                  >
                    Log
                  </Menu>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
    </Section>
  );
}

function NutritionHistory({
  workspaceId,
  today,
  units,
}: {
  workspaceId: string;
  today: string;
  units: Units;
}) {
  const start = addDays(today, -13);
  const history = useNutritionHistory(workspaceId, start, today);
  return (
    <Section title="Last 14 days">
      <Loaded resource={history.state} reload={history.reload} skeleton="h-32">
        {({ days }) => {
          const byDay = new Map(days.map((d) => [d.day, d.nutrients.energy_cal]));
          const bars = Array.from({ length: 14 }, (_, i) => {
            const date = addDays(start, i);
            return { label: date.slice(8), value: (byDay.get(date) ?? 0) / 1000 };
          });
          return (
            <BarChart
              title="Energy per day"
              bars={bars}
              format={(kcal) => formatEnergy(kcal * 1000, units.energy_unit)}
            />
          );
        }}
      </Loaded>
    </Section>
  );
}

function SavedFoods({
  workspaceId,
  units,
  act,
  confirm,
}: {
  workspaceId: string;
  units: Units;
  act: Act;
  confirm: Confirm;
}) {
  const foods = useFoods(workspaceId);
  const [editing, setEditing] = useState<Food | "new" | null>(null);
  async function remove(food: Food) {
    const ok = await confirm({
      title: `Delete ${food.name}?`,
      description: "Entries you already logged keep their nutrients.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) act((token) => deleteFood(token, workspaceId, food.id));
  }
  return (
    <Section
      title="Saved foods"
      description="Foods you eat often, with their nutrients per serving. Most used first."
      action={
        <Button variant="soft" size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" />
          New food
        </Button>
      }
    >
      <Loaded resource={foods.state} reload={foods.reload} skeleton="h-16">
        {({ foods: list }) =>
          list.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No saved foods. Enter nutrients by hand; Orbit doesn’t use a food database.
            </p>
          ) : (
            <ul className="grid gap-2 @3xl:grid-cols-2">
              {list.map((food) => (
                <li
                  key={food.id}
                  className="flex items-center justify-between gap-2 rounded-lg border p-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{food.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatQuantity(food.serving_quantity_milli)} {food.serving_unit} ·{" "}
                      {formatEnergy(food.nutrients.energy_cal, units.energy_unit)} ·{" "}
                      {formatGrams(food.nutrients.protein_mg)} protein
                    </p>
                  </div>
                  <Menu
                    variant="ghost"
                    size="icon"
                    chevron={false}
                    align="end"
                    aria-label={`Actions for ${food.name}`}
                    items={[
                      { id: "edit", label: "Edit", icon: Pencil, onSelect: () => setEditing(food) },
                      {
                        id: "delete",
                        label: "Delete",
                        icon: Trash2,
                        destructive: true,
                        onSelect: () => void remove(food),
                      },
                    ]}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Menu>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      {editing ? (
        <FoodDialog
          workspaceId={workspaceId}
          editing={editing === "new" ? null : editing}
          units={units}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Section>
  );
}

type NutrientName = "energy" | "protein" | "carbs" | "fat" | "fiber";
const NUTRIENTS: readonly NutrientName[] = ["energy", "protein", "carbs", "fat", "fiber"];

/** The five nutrient inputs, registered by the form that owns them. */
function NutrientInputs({
  fields,
  errors,
  units,
}: {
  fields: Record<NutrientName, UseFormRegisterReturn>;
  errors: Partial<Record<NutrientName, { message?: string }>>;
  units: Units;
}) {
  const labels: Record<NutrientName, string> = {
    energy: `Energy (${units.energy_unit === "kcal" ? "kcal" : "kJ"})`,
    protein: "Protein (g)",
    carbs: "Carbs (g)",
    fat: "Fat (g)",
    fiber: "Fiber (g)",
  };
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
      {NUTRIENTS.map((name) => (
        <FormField
          key={name}
          label={labels[name]}
          inputMode="decimal"
          {...fields[name]}
          error={errors[name]?.message}
        />
      ))}
    </div>
  );
}

function FoodDialog({
  workspaceId,
  editing,
  units,
  onClose,
}: {
  workspaceId: string;
  editing: Food | null;
  units: Units;
  onClose: () => void;
}) {
  const run = useFitnessAction(workspaceId);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FoodFormValues>({
    resolver: yupResolver(foodSchema),
    defaultValues: editing ? toFoodFormValues(editing, units) : newFoodValues(),
  });

  async function save(values: FoodFormValues, close: () => void) {
    try {
      await run((token) =>
        saveFood(token, workspaceId, editing?.id ?? null, toFoodRequest(values, units)),
      );
      close();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save the food.") });
    }
  }

  return (
    <DialogShell
      title={editing ? "Edit food" : "New food"}
      description="Nutrients are for one serving. Entries already logged keep theirs."
      busy={isSubmitting}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel="Save food"
      wide
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem_8rem]">
        <FormField
          label="Name"
          autoFocus
          autoComplete="off"
          {...register("name")}
          error={errors.name?.message}
        />
        <FormField
          label="Serving"
          inputMode="decimal"
          {...register("servingQuantity")}
          error={errors.servingQuantity?.message}
        />
        <FormField
          label="Unit"
          placeholder="g, cup"
          {...register("servingUnit")}
          error={errors.servingUnit?.message}
        />
      </div>
      <NutrientInputs
        fields={{
          energy: register("energy"),
          protein: register("protein"),
          carbs: register("carbs"),
          fat: register("fat"),
          fiber: register("fiber"),
        }}
        errors={errors}
        units={units}
      />
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

function FoodEntryDialog({
  workspaceId,
  day,
  meal,
  editing,
  units,
  onClose,
}: {
  workspaceId: string;
  day: string;
  meal: MealType;
  editing: FoodEntry | null;
  units: Units;
  onClose: () => void;
}) {
  const id = useId();
  const run = useFitnessAction(workspaceId);
  const foods = useFoods(workspaceId);
  const list = foods.state.status === "success" ? foods.state.data.foods : [];
  const initial = editing
    ? {
        ...newEntryValues(editing.day, editing.meal),
        foodId: editing.portion.food_id ?? "",
        name: editing.portion.name,
        quantity: quantityInput(editing.portion.quantity_milli),
        servingUnit: editing.portion.serving_unit,
        energy: energyInput(editing.portion.nutrients.energy_cal, units.energy_unit),
        protein: gramsInput(editing.portion.nutrients.protein_mg),
        carbs: gramsInput(editing.portion.nutrients.carbs_mg),
        fat: gramsInput(editing.portion.nutrients.fat_mg),
        fiber: gramsInput(editing.portion.nutrients.fiber_mg),
        note: editing.note,
      }
    : newEntryValues(day, meal);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EntryFormValues>({ resolver: yupResolver(entrySchema), defaultValues: initial });
  const [foodId, quantity] = useWatch({ control, name: ["foodId", "quantity"] });
  const food = list.find((f) => f.id === foodId);
  const milli = parseQuantity(quantity);

  async function save(values: EntryFormValues, close: () => void) {
    try {
      await run(async (token) => {
        let next = values;
        if (!values.foodId && values.saveFood) {
          const portion = toPortionRequest(values, units);
          const saved = await saveFood(token, workspaceId, null, {
            name: values.name,
            serving_quantity_milli: portion.quantity_milli,
            serving_unit: values.servingUnit,
            nutrients: portion.nutrients ?? {
              energy_cal: 0,
              protein_mg: 0,
              carbs_mg: 0,
              fat_mg: 0,
              fiber_mg: null,
            },
          });
          next = { ...values, foodId: saved.id };
        }
        return saveFoodEntry(token, workspaceId, editing?.id ?? null, {
          day: next.day,
          meal: next.meal,
          portion: toPortionRequest(next, units),
          note: next.note,
        });
      });
      close();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save the entry.") });
    }
  }

  return (
    <DialogShell
      title={editing ? "Edit food" : "Add food"}
      busy={isSubmitting}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel={editing ? "Save changes" : "Add"}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <DateField control={control} name="day" label="Date" />
        <SelectField control={control} name="meal" label="Meal" options={MEALS} />
        <SelectField
          control={control}
          name="foodId"
          label="Food"
          options={[
            { value: "", label: "Type it in" },
            ...list.map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
      </div>
      {food ? (
        <div className="space-y-2">
          <FormField
            label={`How much (${food.serving_unit})`}
            inputMode="decimal"
            autoFocus
            hint={`One serving is ${formatQuantity(food.serving_quantity_milli)} ${food.serving_unit}.`}
            {...register("quantity")}
            error={errors.quantity?.message}
          />
          {milli ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              ≈{" "}
              {formatEnergy(
                Math.round((food.nutrients.energy_cal * milli) / food.serving_quantity_milli),
                units.energy_unit,
              )}
              ,{" "}
              {formatGrams(
                Math.round((food.nutrients.protein_mg * milli) / food.serving_quantity_milli),
              )}{" "}
              protein
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem_8rem]">
            <FormField
              label="Food"
              autoFocus
              autoComplete="off"
              {...register("name")}
              error={errors.name?.message}
            />
            <FormField
              label="Amount"
              inputMode="decimal"
              {...register("quantity")}
              error={errors.quantity?.message}
            />
            <FormField
              label="Unit"
              {...register("servingUnit")}
              error={errors.servingUnit?.message}
            />
          </div>
          <p className="text-xs text-muted-foreground">Nutrients for the whole amount.</p>
          <NutrientInputs
            fields={{
              energy: register("energy"),
              protein: register("protein"),
              carbs: register("carbs"),
              fat: register("fat"),
              fiber: register("fiber"),
            }}
            errors={errors}
            units={units}
          />
          {!editing ? (
            <Controller
              control={control}
              name="saveFood"
              render={({ field }) => (
                <label htmlFor={`${id}-save`} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`${id}-save`}
                    checked={field.value}
                    onChange={(event) => field.onChange(event.target.checked)}
                  />
                  Save this food for next time
                </label>
              )}
            />
          ) : null}
        </>
      )}
      <FormField
        label="Note"
        autoComplete="off"
        {...register("note")}
        error={errors.note?.message}
      />
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}
