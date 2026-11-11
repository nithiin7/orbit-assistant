"use client";

import type { FoodRequest } from "@orbit/contracts";
import { Sparkles } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { saveFood } from "@/api/fitness";
import { DialogShell } from "@/components/finance/dialog-shell";
import { FormAlert } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAiReady, useSuggestFoods } from "@/hooks/use-ai";
import { useFitnessAction } from "@/hooks/use-fitness";
import { processingLabel } from "@/lib/ai";
import {
  FOOD_PACKS,
  foodPackRequest,
  formatEnergy,
  formatGrams,
  formatQuantity,
  type Units,
} from "@/lib/fitness";

const PACK_KEY = "orbit:food-pack";

type Idea = { food: FoodRequest; note: string };

function storedPack(): string {
  try {
    const id = window.localStorage.getItem(PACK_KEY);
    if (id && FOOD_PACKS.some((pack) => pack.id === id)) return id;
  } catch {
    // Storage can be unavailable (private windows); the first pack is fine.
  }
  return FOOD_PACKS[0]?.id ?? "";
}

function rememberPack(id: string) {
  try {
    window.localStorage.setItem(PACK_KEY, id);
  } catch {
    // Not remembering the choice is harmless.
  }
}

/**
 * Add common foods of a cuisine to saved foods: from a built-in pack, or, when AI is on, from
 * suggestions for any region the person types. Only the typed region is sent to the AI.
 * Nothing is saved until the person ticks foods and adds them.
 */
export function FoodIdeasDialog({
  workspaceId,
  units,
  savedNames,
  onClose,
}: {
  workspaceId: string;
  units: Units;
  /** Saved food names, lowercased, so foods already saved say so. */
  savedNames: ReadonlySet<string>;
  onClose: () => void;
}) {
  const id = useId();
  const aiReady = useAiReady();
  const suggest = useSuggestFoods(workspaceId);
  const run = useFitnessAction(workspaceId);
  const [packId, setPackId] = useState(storedPack);
  const [cuisine, setCuisine] = useState("");
  const [fromAi, setFromAi] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pack = FOOD_PACKS.find((p) => p.id === packId) ?? FOOD_PACKS[0];
  const ideas: Idea[] =
    fromAi && suggest.data
      ? suggest.data.foods.map(({ note, ...food }) => ({ food, note }))
      : (pack?.foods ?? []).map((item) => ({ food: foodPackRequest(item), note: "" }));
  const keyOf = (idea: Idea) => idea.food.name.toLocaleLowerCase();
  const chosen = ideas.filter((idea) => picked.has(keyOf(idea)));

  function choosePack(next: string) {
    setPackId(next);
    rememberPack(next);
    setFromAi(false);
    setPicked(new Set());
  }

  function askAi() {
    const text = cuisine.trim();
    if (!text) return;
    suggest.mutate(text, {
      onSuccess: () => {
        setFromAi(true);
        setPicked(new Set());
      },
    });
  }

  function onCuisineKey(event: KeyboardEvent<HTMLInputElement>) {
    // Enter asks the AI rather than submitting the dialog.
    if (event.key === "Enter") {
      event.preventDefault();
      askAi();
    }
  }

  function toggle(key: string) {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  }

  async function add(close: () => void) {
    if (chosen.length === 0) {
      setError("Tick the foods to add.");
      return;
    }
    setBusy(true);
    setError(null);
    let added = 0;
    try {
      for (const idea of chosen) {
        await run((token) => saveFood(token, workspaceId, null, idea.food));
        added += 1;
      }
      close();
    } catch (reason) {
      const detail = describeApiError(reason, "Couldn’t add the foods.");
      setError(added > 0 ? `Added ${added} of ${chosen.length}. ${detail}` : detail);
      setPicked(new Set(chosen.slice(added).map(keyOf)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      title="Food ideas"
      description="Common foods with typical nutrients per serving. Adjust them to your recipes after adding."
      busy={busy}
      onClose={onClose}
      onSubmit={(event, close) => {
        event.preventDefault();
        void add(close);
      }}
      submitLabel={
        chosen.length > 0
          ? `Add ${chosen.length} ${chosen.length === 1 ? "food" : "foods"}`
          : "Add foods"
      }
      wide
    >
      <div className="space-y-3">
        <Select
          aria-label="Cuisine"
          value={fromAi ? "" : (pack?.id ?? "")}
          onValueChange={choosePack}
          placeholder={fromAi ? "AI suggestions" : undefined}
          options={FOOD_PACKS.map((p) => ({ value: p.id, label: p.label }))}
        />
        {aiReady ? (
          <div className="space-y-1.5">
            <label htmlFor={`${id}-cuisine`} className="text-sm font-medium">
              Or ask AI about any region or cuisine
            </label>
            <div className="flex gap-2">
              <Input
                id={`${id}-cuisine`}
                value={cuisine}
                maxLength={200}
                placeholder="Kerala, Lebanese, Tex-Mex…"
                onChange={(event) => setCuisine(event.target.value)}
                onKeyDown={onCuisineKey}
              />
              <Button
                variant="soft"
                onClick={askAi}
                disabled={suggest.isPending || cuisine.trim() === ""}
              >
                <Sparkles aria-hidden="true" />
                {suggest.isPending ? "Suggesting…" : "Suggest"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Only the region you type is sent to the AI.
            </p>
          </div>
        ) : null}
        <FormAlert
          message={
            suggest.isError ? describeApiError(suggest.error, "Couldn’t suggest foods.") : null
          }
        />
      </div>

      {fromAi && suggest.data ? (
        <p role="status" className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
          AI estimates for {suggest.data.cuisine}, from {suggest.data.provider_name} (
          {processingLabel(suggest.data.processing)}). Check the numbers before relying on them.
        </p>
      ) : null}

      <ul aria-label="Foods" className="grid gap-2 sm:grid-cols-2">
        {ideas.map((idea) => {
          const key = keyOf(idea);
          const saved = savedNames.has(key);
          const n = idea.food.nutrients;
          return (
            <li key={key}>
              <label className="flex items-start gap-2.5 rounded-lg border p-2.5 has-[:disabled]:opacity-70">
                <Checkbox
                  className="mt-0.5"
                  checked={saved || picked.has(key)}
                  disabled={saved || busy}
                  onChange={() => toggle(key)}
                />
                <span className="min-w-0 space-y-0.5">
                  <span className="flex items-center gap-1.5 text-sm">
                    <span className="truncate">{idea.food.name}</span>
                    {saved ? <Badge>Saved</Badge> : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatQuantity(idea.food.serving_quantity_milli)} {idea.food.serving_unit} ·{" "}
                    {formatEnergy(n.energy_cal, units.energy_unit)} · {formatGrams(n.protein_mg)}{" "}
                    protein
                  </span>
                  {idea.note ? (
                    <span className="block text-xs text-muted-foreground">{idea.note}</span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <FormAlert message={error} />
    </DialogShell>
  );
}
