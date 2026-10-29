"use client";

import type { CreateShoppingItemRequest } from "@orbit/contracts";
import { Plus } from "lucide-react";
import { type FormEvent, type Ref, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { optionalText, validateItemName, validateQuantity, validateUrl } from "@/lib/shopping";

type ItemComposerProps = {
  listName: string;
  onAdd: (draft: CreateShoppingItemRequest) => Promise<void>;
  /** Lets the page focus the name field from its keyboard shortcut. */
  nameRef?: Ref<HTMLInputElement>;
};

type Errors = { name?: string; quantity?: string; url?: string };

/** Quick entry: type an item, optionally a quantity and a link, press Enter. */
export function ItemComposer({ listName, onAdd, nameRef }: ItemComposerProps) {
  const id = useId();
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [url, setUrl] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const next: Errors = {
      name: validateItemName(name),
      quantity: validateQuantity(quantity),
      url: validateUrl(url),
    };
    setErrors(next);
    setFormError(null);
    if (next.name || next.quantity || next.url) return;
    setSaving(true);
    try {
      await onAdd({
        name: name.trim(),
        quantity: optionalText(quantity),
        url: optionalText(url),
        notes: "",
      });
      // Ready for the next item; focus stays where it was.
      setName("");
      setQuantity("");
      setUrl("");
    } catch (reason) {
      setFormError(describeApiError(reason, "Couldn’t add the item. Try again."));
    }
    setSaving(false);
  }

  const messages = [errors.name, errors.quantity, errors.url].filter(Boolean);
  const errorId = `${id}-error`;
  const describedBy = (error: string | undefined) => (error ? errorId : undefined);

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      aria-label={`Add an item to ${listName}`}
      className="space-y-3 rounded-xl border bg-card p-3 shadow-elevation-1 sm:p-4"
    >
      <div className="flex flex-col gap-2 lg:flex-row">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={`${id}-name`} className="sr-only">
            Item
          </label>
          <Input
            ref={nameRef}
            id={`${id}-name`}
            name="name"
            autoComplete="off"
            placeholder="Add an item…"
            aria-keyshortcuts="N"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy(errors.name)}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (errors.name) setErrors((current) => ({ ...current, name: undefined }));
            }}
            className="pr-9"
          />
          <Kbd
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 sm:inline-flex"
          >
            N
          </Kbd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-quantity`} className="sr-only">
            Quantity (optional)
          </label>
          <Input
            id={`${id}-quantity`}
            name="quantity"
            autoComplete="off"
            placeholder="Qty"
            aria-invalid={errors.quantity ? true : undefined}
            aria-describedby={describedBy(errors.quantity)}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="w-24 flex-none"
          />
          <label htmlFor={`${id}-url`} className="sr-only">
            Link (optional)
          </label>
          <Input
            id={`${id}-url`}
            name="url"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="Link (optional)"
            aria-invalid={errors.url ? true : undefined}
            aria-describedby={describedBy(errors.url)}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="min-w-40 flex-1 lg:w-56 lg:flex-none"
          />
          <Button type="submit" disabled={saving} className="flex-1 sm:flex-none">
            <Plus aria-hidden="true" />
            {saving ? "Adding…" : "Add"}
          </Button>
        </div>
      </div>
      {messages.length > 0 ? (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {messages.join(" ")}
        </p>
      ) : null}
      <FormAlert message={formError} />
    </form>
  );
}
