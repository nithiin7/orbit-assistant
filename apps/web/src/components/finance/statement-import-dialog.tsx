"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type {
  FinanceAccount,
  FinanceCategory,
  ImportStatementResult,
  StatementPreview,
  StatementPreviewQuery,
  UndoStatementImportResult,
} from "@orbit/contracts";
import { FileUp, LockKeyhole } from "lucide-react";
import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogFormActions, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { useStatementImport } from "@/hooks/use-statement-import";
import {
  COLUMN_FIELDS,
  type ColumnChoice,
  columnChoice,
  isLocked,
  mappingProblem,
  reviewProblem,
  type ReviewRow,
  statementFileSchema,
  statementPasswordSchema,
  toImportRows,
  toReviewRows,
} from "@/lib/finance";
import { localDateString } from "@/utils/dates";

import { StatementReview } from "./statement-review";

type FileValues = InferType<typeof statementFileSchema>;
type PasswordValues = InferType<typeof statementPasswordSchema>;
type DateOrder = NonNullable<StatementPreviewQuery["date_order"]>;

type Step =
  | { kind: "file" }
  | { kind: "password"; wrong: boolean }
  | { kind: "mapping"; preview: StatementPreview }
  | { kind: "review"; rows: ReviewRow[] }
  | { kind: "done"; result: ImportStatementResult; undone: UndoStatementImportResult | null };

type Source = { accountId: string; file: File; password?: string };

type StatementImportDialogProps = {
  workspaceId: string;
  accounts: readonly FinanceAccount[];
  categories: readonly FinanceCategory[];
  onAnnounce: (message: string) => void;
  onClose: () => void;
};

const NOT_IN_STATEMENT = "";

/**
 * Import a bank statement (PDF, Excel, or CSV) into an account: choose the file, unlock it,
 * map its columns if Orbit can't tell them apart, review every row, then import. Nothing is
 * saved before the last step, and an import can be undone right after.
 */
export function StatementImportDialog({
  workspaceId,
  accounts,
  categories,
  onAnnounce,
  onClose,
}: StatementImportDialogProps) {
  const id = useId();
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: false });
  const { preview, importRows, undo } = useStatementImport(workspaceId);
  const [step, setStep] = useState<Step>({ kind: "file" });
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usable = accounts.filter((account) => !account.archived && account.type !== "loan");
  const account = accounts.find((entry) => entry.id === source?.accountId);

  async function read(next: Source, mapping: Partial<StatementPreviewQuery> = {}) {
    setBusy(true);
    setError(null);
    try {
      const result = await preview(
        next.file,
        { account_id: next.accountId, today: localDateString(), ...mapping },
        next.password,
      );
      setSource(next);
      if (result.status === "password_required") setStep({ kind: "password", wrong: false });
      else if (result.status === "wrong_password") setStep({ kind: "password", wrong: true });
      else if (result.status === "needs_mapping") setStep({ kind: "mapping", preview: result });
      else setStep({ kind: "review", rows: toReviewRows(result.rows) });
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t read this statement. Try again."));
    }
    setBusy(false);
  }

  async function confirm(rows: ReviewRow[]) {
    if (!source) return;
    const problem = reviewProblem(rows);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await importRows.mutateAsync({
        account_id: source.accountId,
        today: localDateString(),
        rows: toImportRows(rows, categories),
      });
      onAnnounce(`Imported ${result.created + result.settled} transactions.`);
      setStep({ kind: "done", result, undone: null });
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t import this statement. Nothing was saved."));
    }
    setBusy(false);
  }

  async function undoImport(result: ImportStatementResult) {
    setBusy(true);
    setError(null);
    try {
      const undone = await undo.mutateAsync(result.batch_id);
      onAnnounce("Undid the import.");
      setStep({ kind: "done", result, undone });
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t undo the import. Try again."));
    }
    setBusy(false);
  }

  return (
    <Dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="mt-[6vh] max-h-[88vh] max-w-2xl overflow-y-auto"
    >
      <div className="space-y-4 p-5">
        <DialogHeader
          titleId={`${id}-heading`}
          title="Import a bank statement"
          description={
            <p className="text-xs text-muted-foreground">
              PDF, Excel, or CSV. Orbit reads the file and doesn’t keep it.
            </p>
          }
          onClose={close}
        />

        {step.kind === "file" ? (
          <FileStep
            accounts={usable}
            busy={busy}
            error={error}
            onCancel={close}
            onSubmit={(values) => void read({ accountId: values.accountId, file: values.file })}
          />
        ) : step.kind === "password" && source ? (
          <PasswordStep
            wrong={step.wrong}
            busy={busy}
            error={error}
            onCancel={close}
            onSubmit={(password) => void read({ ...source, password })}
          />
        ) : step.kind === "mapping" && source ? (
          <MappingStep
            preview={step.preview}
            busy={busy}
            error={error}
            onCancel={close}
            onSubmit={(mapping) => void read(source, mapping)}
          />
        ) : step.kind === "review" && account ? (
          <div className="space-y-4">
            <ReviewSummary rows={step.rows} />
            <StatementReview
              rows={step.rows}
              currency={account.currency}
              categories={categories}
              otherAccounts={usable.filter(
                (entry) => entry.id !== account.id && entry.currency === account.currency,
              )}
              onChange={(index, change) =>
                setStep({
                  kind: "review",
                  rows: step.rows.map((row, at) => (at === index ? { ...row, ...change } : row)),
                })
              }
            />
            <FormAlert message={error} />
            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button
                disabled={busy || toImportRows(step.rows, categories).length === 0}
                onClick={() => void confirm(step.rows)}
              >
                {busy ? "Importing…" : `Import ${toImportRows(step.rows, categories).length}`}
              </Button>
            </DialogFooter>
          </div>
        ) : step.kind === "done" ? (
          <div className="space-y-4">
            <p role="status" className="text-sm">
              {step.undone
                ? `Undid the import: removed ${step.undone.removed} transactions.` +
                  (step.undone.kept
                    ? ` Kept ${step.undone.kept} that a payment or goal now uses.`
                    : "")
                : `Added ${step.result.created} transactions` +
                  (step.result.settled ? ` and marked ${step.result.settled} payments paid` : "") +
                  "."}
            </p>
            <FormAlert message={error} />
            <DialogFooter>
              {step.undone ? null : (
                <Button variant="soft" disabled={busy} onClick={() => void undoImport(step.result)}>
                  {busy ? "Undoing…" : "Undo import"}
                </Button>
              )}
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function ReviewSummary({ rows }: { rows: readonly ReviewRow[] }) {
  const count = (test: (row: ReviewRow) => boolean) => rows.filter(test).length;
  const adding = count((row) => !isLocked(row.row) && row.choice !== "skip");
  const flagged = count((row) => isLocked(row.row));
  return (
    <p className="text-sm text-muted-foreground">
      {`${rows.length} rows: ${adding} to import, ${rows.length - adding} skipped.`}
      {flagged ? ` ${flagged} didn’t match the statement’s balance and can’t be imported.` : ""}
    </p>
  );
}

function FileStep({
  accounts,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  accounts: readonly FinanceAccount[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: FileValues) => void;
}) {
  const id = useId();
  const initial =
    accounts.find((account) => account.is_default) ?? (accounts.length === 1 ? accounts[0] : null);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FileValues>({
    resolver: yupResolver(statementFileSchema),
    defaultValues: { accountId: initial?.id ?? "" },
  });
  return (
    <form noValidate className="space-y-4" onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
      <SelectField
        control={control}
        name="accountId"
        label="Account"
        placeholder="Choose an account…"
        options={accounts.map((account) => ({ value: account.id, label: account.name }))}
      />
      <div className="space-y-1.5">
        <label htmlFor={`${id}-file`} className="block text-sm font-medium">
          Statement file
        </label>
        <Controller
          control={control}
          name="file"
          render={({ field }) => (
            <Input
              id={`${id}-file`}
              ref={field.ref}
              type="file"
              accept=".pdf,.xlsx,.xls,.csv,.txt,application/pdf,text/csv"
              aria-invalid={errors.file ? true : undefined}
              aria-describedby={errors.file ? `${id}-file-error` : undefined}
              onBlur={field.onBlur}
              onChange={(event) => field.onChange(event.target.files?.[0])}
            />
          )}
        />
        {errors.file ? (
          <p id={`${id}-file-error`} className="text-xs font-medium text-destructive">
            {errors.file.message}
          </p>
        ) : null}
      </div>
      <FormAlert message={error} />
      <DialogFormActions
        busy={busy}
        onCancel={onCancel}
        submitLabel={
          <>
            <FileUp aria-hidden="true" />
            Read statement
          </>
        }
        busyLabel="Reading…"
      />
    </form>
  );
}

function PasswordStep({
  wrong,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  wrong: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PasswordValues>({
    resolver: yupResolver(statementPasswordSchema),
    defaultValues: { password: "" },
  });
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => void handleSubmit((values) => onSubmit(values.password))(event)}
    >
      <p className="flex items-start gap-2 text-sm">
        <LockKeyhole className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        This PDF is password-protected. Banks often use part of your name or customer ID and your
        date of birth; the statement email usually says which.
      </p>
      <FormField
        label="PDF password"
        type="password"
        autoComplete="off"
        hint="Used only to open the file. Orbit never saves it."
        error={
          errors.password?.message ?? (wrong ? "That password didn’t open the PDF." : undefined)
        }
        {...register("password")}
      />
      <FormAlert message={error} />
      <DialogFormActions
        busy={busy}
        onCancel={onCancel}
        submitLabel="Unlock"
        busyLabel="Unlocking…"
      />
    </form>
  );
}

function MappingStep({
  preview,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  preview: StatementPreview;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (mapping: Partial<StatementPreviewQuery>) => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState<ColumnChoice>(() => columnChoice(preview.columns));
  const [dateOrder, setDateOrder] = useState<DateOrder>("dmy");
  const [problem, setProblem] = useState<string | null>(null);
  const columnOptions = [
    { value: NOT_IN_STATEMENT, label: "Not in this statement" },
    ...preview.headers.map((header, index) => ({
      value: String(index),
      label: header || `Column ${index + 1}`,
    })),
  ];
  const position = (value: string) => (value === "" ? undefined : Number(value));

  function submit() {
    const found = mappingProblem(choice);
    setProblem(found);
    if (found) return;
    onSubmit({
      header_row: preview.header_row ?? 0,
      date_column: position(choice.date),
      description_column: position(choice.description),
      withdrawal_column: position(choice.withdrawal),
      deposit_column: position(choice.deposit),
      amount_column: position(choice.amount),
      direction_column: position(choice.direction),
      balance_column: position(choice.balance),
      ...(preview.needs_date_order ? { date_order: dateOrder } : {}),
    });
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="text-sm">
        {preview.columns
          ? "Orbit needs to know how this statement writes its dates."
          : "Orbit couldn’t tell this statement’s columns apart. Choose which column holds what."}
      </p>
      {preview.columns ? null : (
        <div className="grid gap-3 sm:grid-cols-2">
          {COLUMN_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <label htmlFor={`${id}-${field.key}`} className="block text-sm font-medium">
                {field.label}
              </label>
              <Select
                id={`${id}-${field.key}`}
                value={choice[field.key]}
                onValueChange={(value) => setChoice({ ...choice, [field.key]: value })}
                options={columnOptions}
              />
            </div>
          ))}
        </div>
      )}
      {preview.needs_date_order ? (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-order`} className="block text-sm font-medium">
            Dates are written
          </label>
          <Select
            id={`${id}-order`}
            value={dateOrder}
            onValueChange={setDateOrder}
            options={[
              { value: "dmy", label: "Day first (31/12/2026)" },
              { value: "mdy", label: "Month first (12/31/2026)" },
            ]}
          />
        </div>
      ) : null}
      <FormAlert message={problem ?? error} />
      <DialogFormActions
        busy={busy}
        onCancel={onCancel}
        submitLabel="Continue"
        busyLabel="Reading…"
      />
    </form>
  );
}
