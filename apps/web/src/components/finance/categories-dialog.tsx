"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { FinanceCategory } from "@orbit/contracts";
import { X } from "lucide-react";
import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useFinanceMutations } from "@/hooks/use-finance";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { categorySchema } from "@/lib/finance";
import type { Option } from "@/utils/common";

type CategoryValues = InferType<typeof categorySchema>;

const CATEGORY_TYPES: readonly Option<CategoryValues["type"]>[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
];

type CategoriesDialogProps = {
  workspaceId: string;
  categories: FinanceCategory[];
  onAnnounce: (message: string) => void;
  onClose: () => void;
};

/** Add and delete the categories transactions are filed under, in a modal. */
export function CategoriesDialog({
  workspaceId,
  categories,
  onAnnounce,
  onClose,
}: CategoriesDialogProps) {
  const id = useId();
  const { close, dialogProps } = useModalDialog({ onClose });
  const { createCategory, deleteCategory } = useFinanceMutations(workspaceId);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError: setFormError,
    formState: { errors, isSubmitting },
  } = useForm<CategoryValues>({
    resolver: yupResolver(categorySchema),
    defaultValues: { name: "", type: "expense" },
  });

  async function add(values: CategoryValues) {
    setError(null);
    try {
      const created = await createCategory.mutateAsync(values);
      reset({ name: "", type: values.type });
      onAnnounce(`Added the category “${created.name}”.`);
    } catch (reason) {
      setFormError("root.server", {
        message: describeApiError(reason, "Couldn’t add the category. Try again."),
      });
    }
  }

  async function remove(category: FinanceCategory) {
    setError(null);
    try {
      await deleteCategory.mutateAsync(category);
      onAnnounce(`Deleted the category “${category.name}”.`);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t delete the category. Try again."));
    }
  }

  const alert = errors.root?.server?.message ?? error;

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[6vh] max-h-[88vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 id={`${id}-heading`} className="text-base font-semibold">
              Categories
            </h2>
            <p className="text-xs text-muted-foreground">
              Built-in categories can’t be deleted. Your own can, once no transaction uses them.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mt-1.5 -mr-1.5 size-8"
            aria-label="Close"
            onClick={close}
          >
            <X aria-hidden="true" />
          </Button>
        </div>

        <form
          noValidate
          onSubmit={(event) => void handleSubmit(add)(event)}
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor={`${id}-name`} className="sr-only">
              New category name
            </label>
            <Input
              id={`${id}-name`}
              placeholder="New category, such as Pets"
              autoComplete="off"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${id}-name-error` : undefined}
              {...register("name")}
            />
            {errors.name ? (
              <p id={`${id}-name-error`} className="text-xs font-medium text-destructive">
                {errors.name.message}
              </p>
            ) : null}
          </div>
          <label htmlFor={`${id}-type`} className="sr-only">
            Category type
          </label>
          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <Select
                id={`${id}-type`}
                ref={field.ref}
                className="sm:w-32"
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                options={CATEGORY_TYPES}
              />
            )}
          />
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add"}
          </Button>
        </form>
        {alert ? <FormAlert message={alert} /> : null}

        {(["expense", "income"] as const).map((type) => {
          const label = type === "income" ? "Income" : "Expenses";
          const listLabel = type === "income" ? "Income categories" : "Expense categories";
          return (
            <section key={type} aria-labelledby={`${id}-${type}`} className="space-y-2">
              <h3 id={`${id}-${type}`} className="text-xs font-medium text-muted-foreground">
                {label}
              </h3>
              <ul aria-label={listLabel} className="flex flex-wrap gap-1.5">
                {categories
                  .filter((category) => category.type === type)
                  .map((category) => (
                    <li key={category.id}>
                      <Badge variant="outline" className="gap-1 py-1 text-foreground">
                        {category.name}
                        {category.is_default ? null : (
                          <button
                            type="button"
                            aria-label={`Delete the category “${category.name}”`}
                            onClick={() => void remove(category)}
                            className="-mr-1 rounded-full p-0.5 text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <X className="size-3" aria-hidden="true" />
                          </button>
                        )}
                      </Badge>
                    </li>
                  ))}
              </ul>
            </section>
          );
        })}
      </div>
    </dialog>
  );
}
