"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Asset, FinanceAccount } from "@orbit/contracts";
import { Gem, Plus } from "lucide-react";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { FormAlert, FormField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAssets, useInvestmentMutations, useValuations } from "@/hooks/use-investments";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  formatMoney,
  parseAmount,
  toDecimalString,
} from "@/lib/finance";
import {
  ASSET_CATEGORIES,
  assetCategoryLabel,
  assetSchema,
  parseValue,
  valuationSchema,
} from "@/lib/investments";
import { formatCalendarDate, localDateString } from "@/utils/dates";

import { ConfirmAction } from "./commitment-parts";
import { DialogShell } from "./dialog-shell";
import { Panel } from "./finance-overview";
import type { FinanceData } from "./finance-view";
import { FreshnessBadge } from "./investment-parts";
import { ErrorPanel } from "./investments-view";
import { SelectField } from "./transaction-dialog";

type Dialog = { kind: "asset"; asset?: Asset } | { kind: "value"; asset: Asset };

/**
 * Gold, property, vehicles, cash outside any account: valued by hand, with a dated history.
 * Assets already counted in an account's balance are listed but left out of net worth.
 */
export function AssetsView({ workspaceId, accounts, onAnnounce }: FinanceData) {
  const today = localDateString();
  const assets = useAssets(workspaceId, today);
  const { updateAsset } = useInvestmentMutations(workspaceId);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  const common = { workspaceId, onSaved: onAnnounce, onClose: close };
  const dialogs =
    dialog?.kind === "asset" ? (
      <AssetDialog {...common} asset={dialog.asset} accounts={accounts} />
    ) : dialog?.kind === "value" ? (
      <ValuationDialog {...common} asset={dialog.asset} />
    ) : null;

  const state = assets.state;
  if (state.status === "error")
    return <ErrorPanel message={state.message} onRetry={assets.reload} />;
  if (state.status === "loading") {
    return (
      <div className="space-y-4">
        <span className="sr-only">Loading assets…</span>
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  const list = state.data.assets;
  if (list.length === 0) {
    return (
      <>
        <EmptyState
          icon={Gem}
          title="Track other assets"
          description="Gold, property, a vehicle, or cash kept outside your accounts. Enter what each is worth now and then; Orbit keeps the history."
        >
          <Button onClick={() => setDialog({ kind: "asset" })}>
            <Plus aria-hidden="true" />
            Add asset
          </Button>
        </EmptyState>
        {dialogs}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => setDialog({ kind: "asset" })}>
          <Plus aria-hidden="true" />
          Add asset
        </Button>
      </div>
      <Panel
        title="Other assets"
        description="Valued by hand. A valuation over a year old is marked stale; one without any valuation counts at its purchase cost."
        flush
      >
        <ul className="divide-y border-t">
          {list.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              workspaceId={workspaceId}
              onEdit={() => setDialog({ kind: "asset", asset })}
              onValue={() => setDialog({ kind: "value", asset })}
              onArchive={async (archived) => {
                try {
                  await updateAsset.mutateAsync({ id: asset.id, body: { archived } });
                  onAnnounce(archived ? `Archived “${asset.name}”.` : `Restored “${asset.name}”.`);
                } catch (reason) {
                  onAnnounce(describeApiError(reason, "Couldn’t change the asset."));
                }
              }}
            />
          ))}
        </ul>
      </Panel>
      {dialogs}
    </div>
  );
}

function AssetRow({
  asset,
  workspaceId,
  onEdit,
  onValue,
  onArchive,
}: {
  asset: Asset;
  workspaceId: string;
  onEdit: () => void;
  onValue: () => void;
  onArchive: (archived: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const history = useValuations(workspaceId, asset.id, open);
  const historyId = useId();
  return (
    <li className="space-y-3 px-5 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="font-medium">
            {asset.name}
            {asset.archived ? (
              <span className="text-muted-foreground"> (sold or disposed of)</span>
            ) : null}
          </p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{assetCategoryLabel(asset.category)}</span>
            {asset.purchase_cost !== null ? (
              <span>Bought for {formatMoney(asset.purchase_cost, asset.currency)}</span>
            ) : null}
            <FreshnessBadge freshness={asset.freshness} />
            {!asset.counted && !asset.archived ? (
              <Badge variant="outline">Not in net worth</Badge>
            ) : null}
          </p>
          {asset.excluded_reason && !asset.archived ? (
            <p className="text-xs text-muted-foreground">{asset.excluded_reason}</p>
          ) : null}
        </div>
        <div className="text-left sm:text-right">
          <p className="text-lg font-semibold tabular-nums">
            {formatMoney(asset.value, asset.currency)}
          </p>
          <p className="text-xs text-muted-foreground">
            {asset.latest_valuation
              ? `Valued ${formatCalendarDate(asset.latest_valuation.valued_on)}`
              : "No valuation yet"}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {asset.archived ? null : (
          <Button size="sm" variant="outline" onClick={onValue}>
            Update value
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          aria-controls={historyId}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide history" : "History"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        {asset.archived ? (
          <Button size="sm" variant="ghost" onClick={() => void onArchive(false)}>
            Restore
          </Button>
        ) : (
          <ConfirmAction
            label="Archive"
            prompt={`Mark “${asset.name}” as sold or disposed of?`}
            options={[
              { label: "Archive asset", destructive: true, onConfirm: () => onArchive(true) },
            ]}
          />
        )}
      </div>
      {open ? (
        <div id={historyId}>
          {history.state.status === "loading" ? (
            <Skeleton className="h-12" />
          ) : history.state.status === "error" ? (
            <p role="alert" className="text-sm">
              {history.state.message}
            </p>
          ) : history.state.data.valuations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No valuations recorded.</p>
          ) : (
            <ul aria-label={`${asset.name} valuations`} className="space-y-1 text-sm">
              {history.state.data.valuations.map((entry) => (
                <li key={entry.id} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">
                    {formatCalendarDate(entry.valued_on)}
                  </span>
                  <span className="tabular-nums">{formatMoney(entry.value, asset.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}

type AssetValues = InferType<typeof assetSchema>;

function AssetDialog({
  workspaceId,
  asset,
  accounts,
  onSaved,
  onClose,
}: {
  workspaceId: string;
  asset?: Asset;
  accounts: readonly FinanceAccount[];
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const notesId = useId();
  const { createAsset, updateAsset } = useInvestmentMutations(workspaceId);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<AssetValues>({
    resolver: yupResolver(assetSchema),
    defaultValues: {
      name: asset?.name ?? "",
      category: asset?.category ?? "gold",
      currency: asset?.currency ?? DEFAULT_CURRENCY,
      purchaseDate: asset?.purchase_date ?? "",
      purchaseCost:
        asset?.purchase_cost !== null && asset?.purchase_cost !== undefined
          ? toDecimalString(asset.purchase_cost, asset.currency)
          : "",
      currentValue: "",
      valuedOn: localDateString(),
      linkedAccountId: asset?.linked_account_id ?? "",
      includeInNetWorth: asset?.include_in_net_worth ?? true,
      notes: asset?.notes ?? "",
    },
  });
  const currency = useWatch({ control, name: "currency" });
  const linkable = accounts.filter((account) => account.currency === currency);

  async function save(values: AssetValues, close: () => void) {
    const cost = values.purchaseCost ? parseAmount(values.purchaseCost, currency) : null;
    const value = values.currentValue ? parseValue(values.currentValue, currency) : null;
    const common = {
      name: values.name,
      category: values.category,
      purchase_date: values.purchaseDate || null,
      purchase_cost: cost,
      linked_account_id: values.linkedAccountId || null,
      include_in_net_worth: values.includeInNetWorth,
      notes: values.notes,
    };
    try {
      if (asset) {
        await updateAsset.mutateAsync({ id: asset.id, body: common });
        onSaved(`Saved “${values.name}”.`);
      } else {
        await createAsset.mutateAsync({
          ...common,
          currency: values.currency,
          current_value: value,
          valued_on: value !== null ? values.valuedOn : null,
        });
        onSaved(`Added “${values.name}”.`);
      }
      close();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save the asset.") });
    }
  }

  return (
    <DialogShell
      title={asset ? "Edit asset" : "Add an asset"}
      description="Something you own that isn’t an account balance or an investment holding."
      busy={saving}
      onClose={onClose}
      submitLabel={asset ? "Save changes" : "Add asset"}
      wide
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Name"
          autoComplete="off"
          autoFocus
          placeholder="Gold coins, Flat in Pune…"
          {...register("name")}
          error={errors.name?.message}
        />
        <SelectField label="Category" {...register("category")}>
          {ASSET_CATEGORIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        {asset ? null : (
          <SelectField label="Currency" {...register("currency")}>
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </SelectField>
        )}
        <FormField label="Bought on (optional)" type="date" {...register("purchaseDate")} />
        <FormField
          label={`Purchase cost (${currency}, optional)`}
          inputMode="decimal"
          autoComplete="off"
          {...register("purchaseCost")}
          error={errors.purchaseCost?.message}
        />
        {asset ? null : (
          <>
            <FormField
              label={`Current value (${currency}, optional)`}
              inputMode="decimal"
              autoComplete="off"
              {...register("currentValue")}
              error={errors.currentValue?.message}
            />
            <FormField label="Valued on" type="date" {...register("valuedOn")} />
          </>
        )}
        <SelectField label="Related account (optional)" {...register("linkedAccountId")}>
          <option value="">None</option>
          {linkable.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectField>
      </div>
      <p className="text-xs text-muted-foreground">
        Linking a bank, cash, or investment account means this asset is already counted in that
        balance, so net worth leaves it out. Linking a loan (for a financed vehicle) keeps it in.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-brand" {...register("includeInNetWorth")} />
        Include in net worth
      </label>
      <div className="space-y-1.5">
        <label htmlFor={notesId} className="block text-sm font-medium">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea id={notesId} rows={2} {...register("notes")} />
      </div>
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

type ValuationValues = InferType<typeof valuationSchema>;

function ValuationDialog({
  workspaceId,
  asset,
  onSaved,
  onClose,
}: {
  workspaceId: string;
  asset: Asset;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const { recordValuation } = useInvestmentMutations(workspaceId);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<ValuationValues>({
    resolver: yupResolver(valuationSchema),
    defaultValues: {
      currency: asset.currency,
      valuedOn: localDateString(),
      value: toDecimalString(asset.value, asset.currency),
    },
  });

  async function save(values: ValuationValues, close: () => void) {
    const value = parseValue(values.value, asset.currency);
    if (value === null) return;
    try {
      await recordValuation.mutateAsync({
        id: asset.id,
        body: { valued_on: values.valuedOn, value, notes: "" },
      });
      onSaved(`Updated the value of “${asset.name}”.`);
      close();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save the value.") });
    }
  }

  return (
    <DialogShell
      title="Update value"
      description={`${asset.name}. Earlier values stay in its history.`}
      busy={saving}
      onClose={onClose}
      submitLabel="Save value"
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Valued on"
          type="date"
          {...register("valuedOn")}
          error={errors.valuedOn?.message}
        />
        <FormField
          label={`Value (${asset.currency})`}
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          {...register("value")}
          error={errors.value?.message}
        />
      </div>
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}
