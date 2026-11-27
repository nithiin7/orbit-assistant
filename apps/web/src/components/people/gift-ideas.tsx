"use client";

import type { Person } from "@orbit/contracts";
import { ArrowRight, Gift, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useGiftIdeas } from "@/hooks/use-people";
import { cn } from "@/utils/common";

import { SectionCard } from "./section-card";

const NAME_MAX_LENGTH = 200;

/**
 * Gift ideas for one person. Each is an item on the default shopping list, so it's there when
 * you shop; ticking it here marks it bought there too.
 */
export function GiftIdeas({ workspaceId, person }: { workspaceId: string; person: Person }) {
  const { gifts, add, toggle } = useGiftIdeas(workspaceId);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mine =
    gifts.status === "success"
      ? gifts.data.items.filter((item) => item.person_id === person.id)
      : [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await add.mutateAsync({ personId: person.id, name: trimmed });
      setName("");
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t add the gift idea. Try again."));
    }
  }

  return (
    <SectionCard
      icon={Gift}
      title="Gift ideas"
      action={
        <Link
          href="/shopping"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7")}
        >
          Shopping
          <ArrowRight aria-hidden="true" />
        </Link>
      }
    >
      {gifts.status === "error" ? (
        <p className="text-sm text-muted-foreground">{gifts.message}</p>
      ) : mine.length > 0 ? (
        <ul className="space-y-1.5" aria-label={`Gift ideas for ${person.name}`}>
          {mine.map((item) => {
            const bought = item.status === "purchased";
            return (
              <li
                key={item.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 transition-colors",
                  bought ? "bg-muted/30" : "bg-muted/50",
                )}
              >
                <Checkbox
                  aria-label={`${bought ? "Bought" : "Mark bought"}: ${item.name}`}
                  checked={bought}
                  disabled={toggle.isPending}
                  onChange={() => toggle.mutate(item)}
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span
                    data-done={bought || undefined}
                    className={cn("strike-sweep", bought && "text-muted-foreground")}
                  >
                    {item.name}
                  </span>
                </span>
                {bought ? (
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                    Bought
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : gifts.status === "success" ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          <Sparkles className="size-4 shrink-0 text-brand" aria-hidden="true" />
          Jot down ideas as they come; they wait on your shopping list.
        </p>
      ) : null}
      <form onSubmit={(event) => void submit(event)} className="flex gap-2">
        <Input
          aria-label={`New gift idea for ${person.name}`}
          placeholder="A gift idea…"
          autoComplete="off"
          maxLength={NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-9 rounded-full"
        />
        <Button
          type="submit"
          variant="soft"
          className="rounded-full"
          disabled={add.isPending || name.trim() === ""}
          aria-label="Add gift idea"
        >
          <Plus aria-hidden="true" />
          Add
        </Button>
      </form>
      <FormAlert message={error} />
    </SectionCard>
  );
}
