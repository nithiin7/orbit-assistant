"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Asset, AssetCategory, FinanceAccount } from "@orbit/contracts";
import {
  Archive,
  ArchiveRestore,
  Banknote,
  Bike,
  Building2,
  Car,
  Coins,
  Gem,
  History,
  House,
  LandPlot,
  Laptop,
  type LucideIcon,
  Package,
  Palette,
  Pencil,
  Plus,
  Store,
  Watch,
} from "lucide-react";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { AmountField, DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAssets, useInvestmentMutations, useValuations } from "@/hooks/use-investments";
import { vehicleLogo } from "@/lib/brand-logos";
import {
  CURRENCY_OPTIONS,
  DEFAULT_CURRENCY,
  formatMoney,
  parseAmount,
  toDecimalString,
} from "@/lib/finance";
import {
  ASSET_CATEGORIES,
  assetCategoryLabel,
  type AssetLook,
  assetLook,
  assetSchema,
  parseValue,
  valuationSchema,
} from "@/lib/investments";
import { cn } from "@/utils/common";
import { formatCalendarDate, localDateString } from "@/utils/dates";

import { DialogShell } from "./dialog-shell";
import { Chip, rowListClassName, twoColumnRows } from "./finance-meta";
import type { FinanceData } from "./finance-view";
import { FreshnessBadge } from "./investment-parts";
import { EndedSection, LoadError } from "./panel";
import { RowActions } from "./row-actions";
import { StatGrid, StatTile } from "./stat-tile";
import { ViewHeader } from "./view-header";

type Dialog = { kind: "asset"; asset?: Asset } | { kind: "value"; asset: Asset };

/**
 * Gold, property, vehicles, cash outside any account: valued by hand, with a dated history.
 * Assets already counted in an account's balance are listed but left out of net worth.
 */
export function AssetsView({ workspaceId, accounts, onAnnounce, currency }: FinanceData) {
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
  const addButton = (
    <Button onClick={() => setDialog({ kind: "asset" })}>
      <Plus aria-hidden="true" />
      Add asset
    </Button>
  );
  const header = (
    <ViewHeader
      title="Other assets"
      description="Gold, property, vehicles, and cash outside your accounts, valued by hand. A valuation over a year old is marked stale; one without any counts at its purchase cost."
      action={addButton}
    />
  );

  const state = assets.state;
  if (state.status === "error") {
    return (
      <div className="space-y-6">
        {header}
        <LoadError message={state.message} onRetry={assets.reload} />
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="space-y-6">
        {header}
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
          {addButton}
        </EmptyState>
        {dialogs}
      </>
    );
  }
  const current = list.filter((asset) => !asset.archived);
  const archived = list.filter((asset) => asset.archived);
  // Only what net worth counts, in the page's currency; currencies are never added together.
  const counted = current.filter((asset) => asset.counted && asset.currency === currency);
  const total = counted.reduce((sum, asset) => sum + asset.value, 0);
  const attention = current.filter((asset) => asset.freshness !== "current").length;
  const row = (asset: Asset) => (
    <AssetRow
      key={asset.id}
      asset={asset}
      workspaceId={workspaceId}
      onEdit={() => setDialog({ kind: "asset", asset })}
      onValue={() => setDialog({ kind: "value", asset })}
      onArchive={async (value) => {
        try {
          await updateAsset.mutateAsync({ id: asset.id, body: { archived: value } });
          onAnnounce(value ? `Archived “${asset.name}”.` : `Restored “${asset.name}”.`);
        } catch (reason) {
          onAnnounce(describeApiError(reason, "Couldn’t change the asset."));
        }
      }}
    />
  );

  return (
    <div className="space-y-6">
      {header}
      {counted.length > 0 ? (
        <StatGrid>
          <StatTile
            label="Counted in net worth"
            icon={Gem}
            accent="brand"
            value={formatMoney(total, currency)}
          >
            {counted.length} {counted.length === 1 ? "asset" : "assets"} at their latest value
          </StatTile>
          {attention > 0 ? (
            <StatTile label="Need a new valuation" value={String(attention)} tone="warning">
              Stale, or never valued
            </StatTile>
          ) : null}
        </StatGrid>
      ) : null}
      {current.length > 0 ? (
        <ul
          aria-label="Assets"
          className={cn(rowListClassName, "grid", twoColumnRows(current.length, "5xl"))}
        >
          {current.map(row)}
        </ul>
      ) : null}
      {archived.length > 0 ? (
        <EndedSection summary={`${archived.length} sold or disposed of`}>
          <ul aria-label="Sold or disposed of" className="@container/rows divide-y">
            {archived.map(row)}
          </ul>
        </EndedSection>
      ) : null}
      {dialogs}
    </div>
  );
}

const LOOK_ICONS: Record<AssetLook, LucideIcon> = {
  car: Car,
  bike: Bike,
  apartment: Building2,
  house: House,
  land: LandPlot,
  commercial: Store,
  gold: Coins,
  jewellery: Gem,
  cash: Banknote,
  watch: Watch,
  gadget: Laptop,
  art: Palette,
  other: Package,
};

/** A soft tint per category, so property, vehicles, and gold are told apart at a glance. */
const CATEGORY_TINTS: Record<AssetCategory, string> = {
  property: "bg-brand-subtle text-brand",
  vehicle: "bg-chart-1/12 text-chart-1",
  gold: "bg-warning/12 text-warning",
  cash: "bg-success/12 text-success",
  other: "bg-muted text-muted-foreground",
};

/** What the asset is, as an icon, or its maker's logo for a vehicle Orbit recognizes. */
function AssetIcon({ asset }: { asset: Asset }) {
  const logo = asset.category === "vehicle" ? vehicleLogo(asset.name) : null;
  if (logo) {
    return (
      <span
        aria-hidden="true"
        title={logo.title}
        className="flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-border"
        style={{ backgroundColor: logo.background, color: logo.foreground }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
          <path d={logo.path} />
        </svg>
      </span>
    );
  }
  const Icon = LOOK_ICONS[assetLook(asset.name, asset.category)];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg",
        CATEGORY_TINTS[asset.category],
      )}
    >
      <Icon className="size-5" />
    </span>
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
    <li className="min-w-0 space-y-3 px-4 py-3.5 @md/rows:px-5">
      <div className="flex items-start gap-3">
        <AssetIcon asset={asset} />
        <div className="min-w-0 flex-1 space-y-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit “${asset.name}”`}
            className="block max-w-full truncate text-left text-sm font-medium outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
          >
            {asset.name}
          </button>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{assetCategoryLabel(asset.category)}</span>
            {asset.purchase_cost !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Bought for {formatMoney(asset.purchase_cost, asset.currency)}</span>
              </>
            ) : null}
            <FreshnessBadge freshness={asset.freshness} />
            {!asset.counted && !asset.archived ? <Chip>Not in net worth</Chip> : null}
          </p>
          {asset.excluded_reason && !asset.archived ? (
            <p className="text-xs text-muted-foreground">{asset.excluded_reason}</p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-semibold whitespace-nowrap tabular-nums">
            {formatMoney(asset.value, asset.currency)}
          </p>
          <p className="text-xs whitespace-nowrap text-muted-foreground">
            {asset.latest_valuation
              ? `Valued ${formatCalendarDate(asset.latest_valuation.valued_on)}`
              : "No valuation yet"}
          </p>
        </div>
      </div>
      <RowActions
        name={asset.name}
        // In line with the name, past the icon.
        className="pl-13"
        primary={
          asset.archived ? null : (
            <Button size="sm" variant="outline" onClick={onValue}>
              Update value
            </Button>
          )
        }
        actions={[
          {
            id: "history",
            label: open ? "Hide history" : "Valuation history",
            icon: History,
            onSelect: () => setOpen(!open),
          },
          { id: "edit", label: "Edit", icon: Pencil, onSelect: onEdit },
          {
            id: "restore",
            label: "Restore",
            icon: ArchiveRestore,
            hidden: !asset.archived,
            onSelect: () => void onArchive(false),
          },
          {
            id: "archive",
            label: "Sold or disposed of…",
            icon: Archive,
            hidden: asset.archived,
            confirm: {
              prompt: `Mark “${asset.name}” as sold or disposed of?`,
              choices: [
                { label: "Archive asset", destructive: true, onConfirm: () => onArchive(true) },
              ],
            },
          },
        ]}
      />
      {open ? (
        <div id={historyId} className="animate-page-in pl-13">
          {history.state.status === "loading" ? (
            <Skeleton className="h-12" />
          ) : history.state.status === "error" ? (
            <LoadError message={history.state.message} onRetry={history.reload} />
          ) : history.state.data.valuations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No valuations recorded.</p>
          ) : (
            <ol
              aria-label={`${asset.name} valuations`}
              className="divide-y rounded-lg border text-sm"
            >
              {history.state.data.valuations.map((entry) => (
                <li key={entry.id} className="flex justify-between gap-3 px-3 py-2">
                  <span className="text-muted-foreground">
                    {formatCalendarDate(entry.valued_on)}
                  </span>
                  <span className="tabular-nums">{formatMoney(entry.value, asset.currency)}</span>
                </li>
              ))}
            </ol>
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
        <SelectField
          control={control}
          name="category"
          label="Category"
          options={ASSET_CATEGORIES}
        />
        {asset ? null : (
          <SelectField
            control={control}
            name="currency"
            label="Currency"
            options={CURRENCY_OPTIONS}
          />
        )}
        <DateField control={control} name="purchaseDate" label="Bought on (optional)" clearable />
        <AmountField
          control={control}
          name="purchaseCost"
          currency={currency}
          label={`Purchase cost (${currency}, optional)`}
        />
        {asset ? null : (
          <>
            <AmountField
              control={control}
              name="currentValue"
              currency={currency}
              label={`Current value (${currency}, optional)`}
            />
            <DateField control={control} name="valuedOn" label="Valued on" />
          </>
        )}
        <SelectField
          control={control}
          name="linkedAccountId"
          label="Related account (optional)"
          options={[
            { value: "", label: "None" },
            ...linkable.map((account) => ({ value: account.id, label: account.name })),
          ]}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Linking a bank, cash, or investment account means this asset is already counted in that
        balance, so net worth leaves it out. Linking a loan (for a financed vehicle) keeps it in.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox {...register("includeInNetWorth")} />
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
    control,
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
        <DateField control={control} name="valuedOn" label="Valued on" />
        <AmountField
          control={control}
          name="value"
          currency={asset.currency}
          label={`Value (${asset.currency})`}
          autoFocus
        />
      </div>
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}
