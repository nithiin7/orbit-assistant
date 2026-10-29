"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { CreateShoppingItemRequest } from "@orbit/contracts";
import { Plus } from "lucide-react";
import { type Ref, useId } from "react";
import { useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { newItemSchema, optionalText } from "@/lib/shopping";
import { mergeRefs } from "@/lib/utils";

type ItemComposerProps = {
  listName: string;
  onAdd: (draft: CreateShoppingItemRequest) => Promise<void>;
  /** Lets the page focus the name field from its keyboard shortcut. */
  nameRef?: Ref<HTMLInputElement>;
};

/** Quick entry: type an item, optionally a quantity and a link, press Enter. */
export function ItemComposer({ listName, onAdd, nameRef }: ItemComposerProps) {
  const id = useId();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(newItemSchema),
    defaultValues: { name: "", quantity: "", url: "" },
  });

  const onSubmit = handleSubmit(async ({ name, quantity, url }) => {
    try {
      await onAdd({ name, quantity: optionalText(quantity), url: optionalText(url), notes: "" });
      // Ready for the next item; focus stays where it was.
      reset();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t add the item. Try again."),
      });
    }
  });

  const nameField = register("name");
  const nameError = errors.name?.message;
  const quantityError = errors.quantity?.message;
  const urlError = errors.url?.message;
  const messages = [nameError, quantityError, urlError].filter(Boolean);
  const errorId = `${id}-error`;
  const describedBy = (error: string | undefined) => (error ? errorId : undefined);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        // Enter in a field submits even while the button is disabled.
        if (isSubmitting) event.preventDefault();
        else void onSubmit(event);
      }}
      aria-label={`Add an item to ${listName}`}
      className="space-y-3 rounded-xl border bg-card p-3 shadow-elevation-1 sm:p-4"
    >
      <div className="flex flex-col gap-2 lg:flex-row">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={`${id}-name`} className="sr-only">
            Item
          </label>
          <Input
            {...nameField}
            ref={mergeRefs(nameField.ref, nameRef)}
            id={`${id}-name`}
            autoComplete="off"
            placeholder="Add an item…"
            aria-keyshortcuts="N"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={describedBy(nameError)}
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
            autoComplete="off"
            placeholder="Qty"
            aria-invalid={quantityError ? true : undefined}
            aria-describedby={describedBy(quantityError)}
            {...register("quantity")}
            className="w-24 flex-none"
          />
          <label htmlFor={`${id}-url`} className="sr-only">
            Link (optional)
          </label>
          <Input
            id={`${id}-url`}
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="Link (optional)"
            aria-invalid={urlError ? true : undefined}
            aria-describedby={describedBy(urlError)}
            {...register("url")}
            className="min-w-40 flex-1 lg:w-56 lg:flex-none"
          />
          <Button type="submit" disabled={isSubmitting} className="flex-1 sm:flex-none">
            <Plus aria-hidden="true" />
            {isSubmitting ? "Adding…" : "Add"}
          </Button>
        </div>
      </div>
      {messages.length > 0 ? (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {messages.join(" ")}
        </p>
      ) : null}
      <FormAlert message={errors.root?.server?.message ?? null} />
    </form>
  );
}
