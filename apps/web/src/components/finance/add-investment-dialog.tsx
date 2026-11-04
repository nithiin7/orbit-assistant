"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { HoldingKind, Instrument, InvestmentAccount } from "@orbit/contracts";
import { Check, Search } from "lucide-react";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { AmountField, DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  useInstrumentSearch,
  useInvestmentMutations,
  useMarketDataEnabled,
} from "@/hooks/use-investments";
import { useDebounced } from "@/hooks/use-universal-search";
import { DEFAULT_CURRENCY, formatMoney, parseAmount } from "@/lib/finance";
import {
  addInvestmentSchema,
  formatUnits,
  HOLDING_KINDS,
  NEW_ACCOUNT,
  parseUnits,
} from "@/lib/investments";
import { cn } from "@/utils/common";
import { localDateString } from "@/utils/dates";

import { DialogShell } from "./dialog-shell";

type Values = InferType<typeof addInvestmentSchema>;

const NOUNS: Record<HoldingKind, string> = {
  mutual_fund: "fund",
  stock: "stock",
  etf: "ETF",
};

/** The account a new holding of this kind most likely belongs in. */
function defaultAccount(accounts: readonly InvestmentAccount[], kind: HoldingKind): string {
  const wanted = kind === "mutual_fund" ? "mutual_fund" : "brokerage";
  return (
    accounts.find((account) => account.kind === wanted)?.account_id ??
    accounts[0]?.account_id ??
    NEW_ACCOUNT
  );
}

/**
 * Adds a mutual fund, stock, or ETF you already own (or are about to buy) in one step: find it
 * by name when the server has market data on (or type its details), pick or create the account
 * it sits in, and say what you hold. Units of a single fund purchase can be left out.
 */
export function AddInvestmentDialog({
  workspaceId,
  investmentAccounts,
  defaultKind = "mutual_fund",
  onSaved,
  onClose,
}: {
  workspaceId: string;
  investmentAccounts: readonly InvestmentAccount[];
  defaultKind?: HoldingKind;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const { createAccount, createHolding } = useInvestmentMutations(workspaceId);
  const marketData = useMarketDataEnabled(workspaceId);
  const usable = investmentAccounts.filter((account) => !account.archived);
  // An account made by an earlier attempt whose holding then failed, so a retry reuses it.
  const [createdAccountId, setCreatedAccountId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Instrument | null>(null);
  const [typing, setTyping] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<Values>({
    resolver: yupResolver(addInvestmentSchema),
    defaultValues: {
      kind: defaultKind,
      accountId: defaultAccount(usable, defaultKind),
      accountName: defaultKind === "mutual_fund" ? "Mutual funds" : "Demat account",
      name: "",
      symbol: "",
      exchange: "",
      isin: "",
      issuer: "",
      category: "",
      folio: "",
      currency: usable[0]?.currency ?? DEFAULT_CURRENCY,
      owned: true,
      amount: "",
      quantity: "",
      tradeDate: localDateString(),
    },
  });
  const kind = useWatch({ control, name: "kind" });
  const accountId = useWatch({ control, name: "accountId" });
  const owned = useWatch({ control, name: "owned" });
  const fund = kind === "mutual_fund";
  const currency =
    usable.find((account) => account.account_id === accountId)?.currency ?? DEFAULT_CURRENCY;
  // A pick of another kind no longer applies once the kind changes.
  const chosen = picked?.kind === kind ? picked : null;
  const manual = !marketData || typing;

  function pick(instrument: Instrument | null) {
    setPicked(instrument);
    setValue("name", instrument?.name ?? "");
    setValue("symbol", instrument?.symbol ?? "");
    setValue("exchange", instrument?.exchange ?? "");
    setValue("isin", instrument?.isin ?? "");
    setValue("issuer", instrument?.issuer ?? "");
    setValue("category", instrument?.category ?? "");
  }

  async function save(values: Values, close: () => void) {
    const amount = values.owned ? parseAmount(values.amount, currency) : null;
    if (values.owned && amount === null) return;
    const quantity = values.owned && values.quantity ? parseUnits(values.quantity) : null;
    try {
      let target = values.accountId;
      if (target === NEW_ACCOUNT) {
        target =
          createdAccountId ??
          (
            await createAccount.mutateAsync({
              name: values.accountName,
              kind: values.kind === "mutual_fund" ? "mutual_fund" : "brokerage",
              provider: "",
              linked_account_id: null,
              currency: DEFAULT_CURRENCY,
              notes: "",
            })
          ).account_id;
        setCreatedAccountId(target);
      }
      const holding = await createHolding.mutateAsync({
        account_id: target,
        kind: values.kind,
        name: values.name,
        symbol: values.symbol,
        exchange: values.exchange,
        isin: values.isin.toUpperCase(),
        issuer: values.issuer,
        category: values.category,
        folio: values.folio,
        notes: "",
        opening:
          values.owned && amount !== null
            ? { trade_date: values.tradeDate, amount, quantity }
            : null,
      });
      onSaved(
        values.owned
          ? `Added “${holding.name}”: ${formatUnits(holding.quantity)} units for ${formatMoney(holding.cost, holding.currency)}.`
          : `Added “${holding.name}”. Record a buy or schedule a SIP to start.`,
      );
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t add it. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title="Add an investment"
      description={
        marketData
          ? "Find it by name, then say what you hold. Prices update automatically."
          : "Enter its details and what you hold."
      }
      busy={saving}
      onClose={onClose}
      submitLabel="Add investment"
      wide
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField control={control} name="kind" label="Type" options={HOLDING_KINDS} />
        <SelectField
          control={control}
          name="accountId"
          label="Held in"
          options={[
            ...usable.map((account) => ({
              value: account.account_id,
              label: `${account.name} (${account.currency})`,
            })),
            { value: NEW_ACCOUNT, label: "A new account…" },
          ]}
        />
        {accountId === NEW_ACCOUNT ? (
          <div className="sm:col-span-2">
            <FormField
              label="New account’s name"
              autoComplete="off"
              hint={fund ? "Such as Coin, Groww, or Kuvera." : "Such as Zerodha or your bank."}
              {...register("accountName")}
              error={errors.accountName?.message}
            />
          </div>
        ) : null}
      </div>

      {chosen ? (
        <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="min-w-0 space-y-0.5">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Check aria-hidden="true" className="size-4 shrink-0 text-brand" />
              <span className="truncate">{chosen.name}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {fund
                ? `Scheme code ${chosen.symbol}`
                : [chosen.symbol, chosen.exchange].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => pick(null)}>
            Change
          </Button>
        </div>
      ) : manual ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormField
                label={fund ? "Scheme name" : "Name"}
                autoComplete="off"
                placeholder={fund ? "Parag Parikh Flexi Cap Fund - Direct Growth" : "Infosys"}
                {...register("name")}
                error={errors.name?.message}
              />
            </div>
            {fund ? (
              <FormField
                label="Scheme code (optional)"
                autoComplete="off"
                inputMode="numeric"
                hint={marketData ? "The AMFI code, so its NAV updates itself." : undefined}
                {...register("symbol")}
              />
            ) : (
              <>
                <FormField
                  label="Symbol (optional)"
                  autoComplete="off"
                  placeholder="INFY"
                  {...register("symbol")}
                />
                <FormField
                  label="Exchange (optional)"
                  autoComplete="off"
                  placeholder="NSE"
                  {...register("exchange")}
                />
              </>
            )}
          </div>
          {marketData ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setTyping(false)}>
              <Search aria-hidden="true" />
              Search instead
            </Button>
          ) : null}
        </div>
      ) : (
        <InstrumentPicker
          workspaceId={workspaceId}
          kind={kind}
          noun={NOUNS[kind]}
          error={errors.name?.message}
          onPick={pick}
          onManual={() => setTyping(true)}
        />
      )}

      <div className="space-y-4 rounded-lg border p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox {...register("owned")} />I already own some
        </label>
        {owned ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <AmountField
              control={control}
              name="amount"
              currency={currency}
              label={`Amount invested (${currency})`}
              hint="What you paid in total, as on your statement."
            />
            <FormField
              label={fund ? "Units held (optional)" : "Units held"}
              inputMode="decimal"
              autoComplete="off"
              hint={
                fund
                  ? "Leave blank for a single purchase: it’s worked out from that day’s NAV. For SIPs or several buys, enter the units on your statement."
                  : "Shares or units, up to 6 decimals."
              }
              {...register("quantity")}
              error={errors.quantity?.message}
            />
            <DateField
              control={control}
              name="tradeDate"
              label={fund ? "Bought on (or statement date)" : "Bought on"}
            />
            {fund ? (
              <FormField
                label="Folio number (optional)"
                autoComplete="off"
                {...register("folio")}
              />
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            It’s added with no units. Record a buy, or schedule a SIP, when you invest.
          </p>
        )}
      </div>
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

/** A search box over the server's price service, with its results as a list to pick from. */
function InstrumentPicker({
  workspaceId,
  kind,
  noun,
  error,
  onPick,
  onManual,
}: {
  workspaceId: string;
  kind: HoldingKind;
  noun: string;
  error?: string;
  onPick: (instrument: Instrument) => void;
  onManual: () => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const query = useDebounced(text.trim(), 300);
  const search = useInstrumentSearch(workspaceId, kind, query, query.length >= 2);
  const results = query.length >= 2 ? (search.data?.instruments ?? []) : [];

  return (
    <div className="space-y-2">
      <label htmlFor={`${id}-search`} className="block text-sm font-medium">
        Find the {noun}
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={`${id}-search`}
          type="search"
          autoComplete="off"
          autoFocus
          className="pl-9"
          placeholder={kind === "mutual_fund" ? "Parag Parikh Flexi Cap" : "Infosys"}
          aria-describedby={`${id}-status`}
          aria-invalid={error ? true : undefined}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <p id={`${id}-status`} className="text-xs text-muted-foreground" aria-live="polite">
        {query.length < 2
          ? (error ?? "Type at least two letters.")
          : search.isError
            ? "Couldn’t reach the price service. Try again, or enter the details yourself."
            : search.isFetching && results.length === 0
              ? "Searching…"
              : results.length === 0
                ? `No ${noun} found by that name.`
                : `${results.length} found.`}
      </p>
      {results.length > 0 ? (
        <ul
          aria-label="Search results"
          className={cn(
            "max-h-56 divide-y overflow-y-auto rounded-lg border",
            search.isFetching && "opacity-70",
          )}
        >
          {results.map((instrument) => (
            <li key={`${instrument.symbol}-${instrument.exchange}`}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => onPick(instrument)}
              >
                <span className="font-medium">{instrument.name}</span>
                <span className="text-xs text-muted-foreground">
                  {kind === "mutual_fund"
                    ? `Scheme code ${instrument.symbol}`
                    : [instrument.symbol, instrument.exchange].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button type="button" variant="ghost" size="sm" onClick={onManual}>
        Can’t find it? Enter the details yourself
      </Button>
    </div>
  );
}
