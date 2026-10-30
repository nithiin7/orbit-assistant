"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type {
  Currency,
  Deposit,
  FinanceAccount,
  Holding,
  InvestmentAccount,
  InvestmentTransactionType,
  Settlement,
  SipPlan,
} from "@orbit/contracts";
import { useId } from "react";
import { useForm, type UseFormRegisterReturn, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useInvestmentMutations } from "@/hooks/use-investments";
import { formatRate, FREQUENCIES, toReminderRequest } from "@/lib/commitments";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  formatMoney,
  isLiability,
  parseAmount,
  toDecimalString,
} from "@/lib/finance";
import {
  closeDepositSchema,
  COMPOUNDING,
  DEPOSIT_KINDS,
  depositSchema,
  HOLDING_KINDS,
  holdingSchema,
  INVESTMENT_ACCOUNT_KINDS,
  investmentAccountSchema,
  parseUnits,
  priceSchema,
  rateToBps,
  sipSchema,
  tradeSchema,
} from "@/lib/investments";
import { localDateString } from "@/utils/dates";
import { browserTimeZone } from "@/utils/time-zones";

import { ReminderFields } from "./commitment-parts";
import { DialogShell } from "./dialog-shell";
import { SelectField } from "./transaction-dialog";

type Common = {
  workspaceId: string;
  onSaved: (message: string) => void;
  onClose: () => void;
};

/** Accounts money can come from or go to: active, in the currency, not loans. */
function cashAccounts(accounts: readonly FinanceAccount[], currency: Currency, exclude?: string) {
  return accounts.filter(
    (account) =>
      !account.archived &&
      account.currency === currency &&
      account.type !== "loan" &&
      account.id !== exclude,
  );
}

function errorMessage(reason: unknown, fallback: string) {
  return describeApiError(reason, fallback);
}

/**
 * Where the money came from or went: the investment account's own cash, another account (Orbit
 * records the transfer, income, or expense there), or outside Orbit (an earlier purchase).
 */
function SettlementFields({
  settlement,
  register,
  accountRegister,
  accounts,
  allowNone,
  accountError,
  direction,
}: {
  settlement: Settlement;
  register: UseFormRegisterReturn;
  accountRegister: UseFormRegisterReturn;
  accounts: readonly FinanceAccount[];
  allowNone: boolean;
  accountError?: string;
  direction: "in" | "out";
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField label={direction === "in" ? "Paid from" : "Paid into"} {...register}>
        <option value="account">Another account</option>
        <option value="investment_account">The investment account’s cash</option>
        {allowNone ? <option value="none">Outside Orbit (already owned)</option> : null}
      </SelectField>
      {settlement === "account" ? (
        <SelectField label="Account" error={accountError} {...accountRegister}>
          <option value="">Choose an account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectField>
      ) : (
        <p className="self-end pb-2 text-xs text-muted-foreground">
          {settlement === "none"
            ? "No money moves in your accounts; the units are added as already owned."
            : "Uses money already moved into the investment account."}
        </p>
      )}
    </div>
  );
}

function NotesField({ register }: { register: UseFormRegisterReturn }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        Notes <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <Textarea id={id} rows={2} {...register} />
    </div>
  );
}

// Investment accounts

type AccountValues = InferType<typeof investmentAccountSchema>;

/**
 * Adds an investment account, either by tracking investments in an existing account of type
 * Investment (its history carries over) or as a new one; or edits one.
 */
export function InvestmentAccountDialog({
  workspaceId,
  account,
  accounts,
  adoptable,
  onSaved,
  onClose,
}: Common & {
  account?: InvestmentAccount;
  accounts: readonly FinanceAccount[];
  /** Existing `investment` accounts that don't track holdings yet. */
  adoptable: readonly FinanceAccount[];
}) {
  const { createAccount, updateAccount } = useInvestmentMutations(workspaceId);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<AccountValues>({
    resolver: yupResolver(investmentAccountSchema),
    defaultValues: {
      mode: account || adoptable.length === 0 ? "new" : "existing",
      name: account?.name ?? "",
      accountId: "",
      kind: account?.kind ?? "mutual_fund",
      provider: account?.provider ?? "",
      currency: account?.currency ?? DEFAULT_CURRENCY,
      linkedAccountId: account?.linked_account_id ?? "",
      notes: account?.notes ?? "",
    },
  });
  const mode = useWatch({ control, name: "mode" });
  const chosen = useWatch({ control, name: "accountId" });
  const typedCurrency = useWatch({ control, name: "currency" });
  const currency =
    mode === "existing"
      ? (adoptable.find((entry) => entry.id === chosen)?.currency ?? DEFAULT_CURRENCY)
      : typedCurrency;
  const linkable = accounts.filter(
    (entry) =>
      !isLiability(entry) &&
      entry.currency === currency &&
      entry.type !== "investment" &&
      !entry.archived,
  );

  async function save(values: AccountValues, close: () => void) {
    try {
      if (account) {
        await updateAccount.mutateAsync({
          id: account.account_id,
          body: {
            name: values.name,
            kind: values.kind,
            provider: values.provider,
            linked_account_id: values.linkedAccountId || null,
            notes: values.notes,
          },
        });
        onSaved(`Saved “${values.name}”.`);
      } else {
        const created = await createAccount.mutateAsync({
          kind: values.kind,
          provider: values.provider,
          linked_account_id: values.linkedAccountId || null,
          currency: values.currency,
          notes: values.notes,
          ...(values.mode === "existing"
            ? { account_id: values.accountId }
            : { name: values.name }),
        });
        onSaved(`“${created.name}” now tracks investments.`);
      }
      close();
    } catch (reason) {
      setError("root.server", {
        message: errorMessage(reason, "Couldn’t save the investment account. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title={account ? "Edit investment account" : "Add an investment account"}
      description="A mutual fund platform, a broker, or where your deposits are. Its balance is the cash in it; holdings are tracked separately."
      busy={saving}
      onClose={onClose}
      submitLabel={account ? "Save changes" : "Add account"}
      wide
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      {!account && adoptable.length > 0 ? (
        <fieldset className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-6">
          <legend className="sr-only">Account</legend>
          <label className="flex items-center gap-2">
            <input type="radio" value="existing" className="accent-brand" {...register("mode")} />
            Use an existing investment account
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" value="new" className="accent-brand" {...register("mode")} />
            Create a new one
          </label>
        </fieldset>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "existing" && !account ? (
          <SelectField label="Account" error={errors.accountId?.message} {...register("accountId")}>
            <option value="">Choose an account</option>
            {adoptable.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} ({entry.currency})
              </option>
            ))}
          </SelectField>
        ) : (
          <FormField
            label="Name"
            autoComplete="off"
            autoFocus
            placeholder="Zerodha, Groww, SBI deposits…"
            {...register("name")}
            error={errors.name?.message}
          />
        )}
        <SelectField label="Type" {...register("kind")}>
          {INVESTMENT_ACCOUNT_KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <FormField
          label="Provider or broker (optional)"
          autoComplete="off"
          {...register("provider")}
          error={errors.provider?.message}
        />
        {mode === "new" && !account ? (
          <SelectField label="Currency" {...register("currency")}>
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </SelectField>
        ) : null}
        <SelectField label="Linked bank account (optional)" {...register("linkedAccountId")}>
          <option value="">None</option>
          {linkable.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </SelectField>
      </div>
      {mode === "new" || account ? <NotesField register={register("notes")} /> : null}
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

// Holdings

type HoldingValues = InferType<typeof holdingSchema>;

export function HoldingDialog({
  workspaceId,
  holding,
  investmentAccounts,
  onSaved,
  onClose,
}: Common & { holding?: Holding; investmentAccounts: readonly InvestmentAccount[] }) {
  const { createHolding, updateHolding } = useInvestmentMutations(workspaceId);
  const usable = investmentAccounts.filter((account) => !account.archived);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<HoldingValues>({
    resolver: yupResolver(holdingSchema),
    defaultValues: {
      accountId: holding?.account_id ?? usable[0]?.account_id ?? "",
      kind: holding?.kind ?? "mutual_fund",
      name: holding?.name ?? "",
      symbol: holding?.symbol ?? "",
      exchange: holding?.exchange ?? "",
      isin: holding?.isin ?? "",
      issuer: holding?.issuer ?? "",
      category: holding?.category ?? "",
      folio: holding?.folio ?? "",
      notes: holding?.notes ?? "",
    },
  });
  const kind = useWatch({ control, name: "kind" });
  const fund = kind === "mutual_fund";

  async function save(values: HoldingValues, close: () => void) {
    const fields = {
      name: values.name,
      symbol: values.symbol,
      exchange: values.exchange,
      isin: values.isin.toUpperCase(),
      issuer: values.issuer,
      category: values.category,
      folio: values.folio,
      notes: values.notes,
    };
    try {
      if (holding) {
        await updateHolding.mutateAsync({ id: holding.id, body: fields });
        onSaved(`Saved “${values.name}”.`);
      } else {
        await createHolding.mutateAsync({
          account_id: values.accountId,
          kind: values.kind,
          ...fields,
        });
        onSaved(`Added “${values.name}”. Record a buy to add its units.`);
      }
      close();
    } catch (reason) {
      setError("root.server", {
        message: errorMessage(reason, "Couldn’t save the holding. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title={holding ? "Edit holding" : "Add a holding"}
      description="Units and cost come from the buys and sales you record, never typed in directly."
      busy={saving}
      onClose={onClose}
      submitLabel={holding ? "Save changes" : "Add holding"}
      wide
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {holding ? null : (
          <>
            <SelectField
              label="Investment account"
              error={errors.accountId?.message}
              {...register("accountId")}
            >
              {usable.map((account) => (
                <option key={account.account_id} value={account.account_id}>
                  {account.name} ({account.currency})
                </option>
              ))}
            </SelectField>
            <SelectField label="Type" {...register("kind")}>
              {HOLDING_KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </>
        )}
        <div className="sm:col-span-2">
          <FormField
            label={fund ? "Scheme name" : "Name"}
            autoComplete="off"
            autoFocus
            placeholder={fund ? "Parag Parikh Flexi Cap Fund - Direct Growth" : "Infosys"}
            {...register("name")}
            error={errors.name?.message}
          />
        </div>
        {fund ? (
          <>
            <FormField
              label="AMC or fund house (optional)"
              autoComplete="off"
              {...register("issuer")}
            />
            <FormField
              label="Scheme category (optional)"
              autoComplete="off"
              placeholder="Flexi cap"
              {...register("category")}
            />
            <FormField label="Scheme code (optional)" autoComplete="off" {...register("symbol")} />
            <FormField label="Folio number (optional)" autoComplete="off" {...register("folio")} />
          </>
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
            <FormField
              label="Sector or category (optional)"
              autoComplete="off"
              {...register("category")}
            />
          </>
        )}
        <FormField
          label="ISIN (optional)"
          autoComplete="off"
          {...register("isin")}
          error={errors.isin?.message}
        />
      </div>
      <NotesField register={register("notes")} />
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

// Trades

type TradeValues = InferType<typeof tradeSchema>;
export type TradeType = "buy" | "sell" | "dividend" | "fee";

const TRADE_TITLES: Record<TradeType, string> = {
  buy: "Record a purchase",
  sell: "Record a sale or redemption",
  dividend: "Record a dividend",
  fee: "Record a fee",
};

/**
 * Records a buy, sale, dividend, or fee on a holding, or an installment of one of its SIPs.
 * Purchases are never spending; dividends are income; fees and charges are expenses.
 */
export function TradeDialog({
  workspaceId,
  holding,
  type: initialType,
  sip,
  account,
  accounts,
  onSaved,
  onClose,
}: Common & {
  holding: Holding;
  type: TradeType;
  /** Record an installment of this SIP. */
  sip?: SipPlan;
  account: InvestmentAccount | undefined;
  accounts: readonly FinanceAccount[];
}) {
  const { recordTransaction, recordSip } = useInvestmentMutations(workspaceId);
  const currency = holding.currency;
  const defaultCash = sip?.funding_account_id ?? account?.linked_account_id ?? "";
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<TradeValues>({
    resolver: yupResolver(tradeSchema),
    defaultValues: {
      type: initialType,
      currency,
      tradeDate: sip?.next_due_date ?? localDateString(),
      amount: sip ? toDecimalString(sip.amount, currency) : "",
      quantity: "",
      fees: "",
      plan: sip ? "sip" : "lump_sum",
      settlement: defaultCash ? "account" : "investment_account",
      cashAccountId: defaultCash,
      notes: "",
    },
  });
  const type = useWatch({ control, name: "type" });
  const settlement = useWatch({ control, name: "settlement" });
  const trade = type === "buy" || type === "sell";
  const usable = cashAccounts(accounts, currency, holding.account_id);

  async function save(values: TradeValues, close: () => void) {
    const amount = parseAmount(values.amount, currency);
    const fees = values.fees ? parseAmount(values.fees, currency) : 0;
    if (amount === null || fees === null) return;
    const quantity = trade ? parseUnits(values.quantity) : null;
    const cash = values.settlement === "account" ? values.cashAccountId : null;
    try {
      if (sip) {
        await recordSip.mutateAsync({
          id: sip.id,
          body: {
            trade_date: values.tradeDate,
            quantity: quantity ?? "",
            amount,
            due_date: sip.next_due_date,
            settlement: values.settlement,
            cash_account_id: cash,
            fees,
            notes: values.notes,
          },
        });
      } else {
        await recordTransaction.mutateAsync({
          type: values.type as InvestmentTransactionType,
          holding_id: holding.id,
          trade_date: values.tradeDate,
          amount,
          quantity: trade ? quantity : null,
          fees: trade ? fees : 0,
          plan: values.type === "buy" ? values.plan : null,
          settlement: values.settlement,
          cash_account_id: cash,
          notes: values.notes,
        });
      }
      onSaved(`Recorded ${formatMoney(amount, currency)} for “${holding.name}”.`);
      close();
    } catch (reason) {
      setError("root.server", {
        message: errorMessage(reason, "Couldn’t record it. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title={sip ? "Record a SIP installment" : TRADE_TITLES[initialType]}
      description={holding.name}
      busy={saving}
      onClose={onClose}
      submitLabel="Record"
      wide
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {sip ? null : (
          <SelectField label="Type" {...register("type")}>
            <option value="buy">Buy</option>
            <option value="sell">Sell or redeem</option>
            <option value="dividend">Dividend</option>
            <option value="fee">Fee or charge</option>
          </SelectField>
        )}
        <FormField
          label="Date"
          type="date"
          {...register("tradeDate")}
          error={errors.tradeDate?.message}
        />
        <FormField
          label={
            type === "sell"
              ? `Proceeds before charges (${currency})`
              : type === "buy"
                ? `Amount invested (${currency})`
                : `Amount (${currency})`
          }
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          {...register("amount")}
          error={errors.amount?.message}
        />
        {trade ? (
          <>
            <FormField
              label="Units"
              inputMode="decimal"
              autoComplete="off"
              hint="Up to 6 decimals, as on your statement."
              {...register("quantity")}
              error={errors.quantity?.message}
            />
            <FormField
              label={`Charges (${currency}, optional)`}
              inputMode="decimal"
              autoComplete="off"
              hint="Brokerage, stamp duty… Recorded as an expense."
              {...register("fees")}
              error={errors.fees?.message}
            />
            {type === "buy" && !sip ? (
              <SelectField label="Kind of purchase" {...register("plan")}>
                <option value="lump_sum">Lump sum</option>
                <option value="sip">SIP installment (unscheduled)</option>
              </SelectField>
            ) : null}
          </>
        ) : null}
      </div>
      <SettlementFields
        settlement={settlement}
        register={register("settlement")}
        accountRegister={register("cashAccountId")}
        accounts={usable}
        allowNone={type === "buy" && !sip}
        accountError={errors.cashAccountId?.message}
        direction={type === "buy" || type === "fee" ? "in" : "out"}
      />
      <NotesField register={register("notes")} />
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

// Prices

type PriceValues = InferType<typeof priceSchema>;

export function PriceDialog({
  workspaceId,
  holding,
  onSaved,
  onClose,
}: Common & { holding: Holding }) {
  const { recordPrice } = useInvestmentMutations(workspaceId);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<PriceValues>({
    resolver: yupResolver(priceSchema),
    defaultValues: { priceDate: localDateString(), price: holding.price?.price ?? "" },
  });

  async function save(values: PriceValues, close: () => void) {
    const price = parseUnits(values.price);
    if (price === null) return;
    try {
      await recordPrice.mutateAsync({
        id: holding.id,
        body: { price_date: values.priceDate, price },
      });
      onSaved(`Updated the price of “${holding.name}”.`);
      close();
    } catch (reason) {
      setError("root.server", { message: errorMessage(reason, "Couldn’t save the price.") });
    }
  }

  return (
    <DialogShell
      title={holding.kind === "mutual_fund" ? "Update NAV" : "Update price"}
      description={`${holding.name}. Orbit doesn’t fetch prices; enter them from your statement or app.`}
      busy={saving}
      onClose={onClose}
      submitLabel="Save price"
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="As of"
          type="date"
          {...register("priceDate")}
          error={errors.priceDate?.message}
        />
        <FormField
          label={`Price per unit (${holding.currency})`}
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          {...register("price")}
          error={errors.price?.message}
        />
      </div>
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

// SIP plans

type SipValues = InferType<typeof sipSchema>;

export function SipDialog({
  workspaceId,
  holding,
  plan,
  accounts,
  onSaved,
  onClose,
}: Common & { holding: Holding; plan?: SipPlan; accounts: readonly FinanceAccount[] }) {
  const { createSip, updateSip } = useInvestmentMutations(workspaceId);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<SipValues>({
    resolver: yupResolver(sipSchema),
    defaultValues: {
      currency: holding.currency,
      amount: plan ? toDecimalString(plan.amount, plan.currency) : "",
      frequency: plan?.frequency ?? "monthly",
      nextDueDate: plan?.next_due_date ?? localDateString(),
      endDate: plan?.end_date ?? "",
      fundingAccountId: plan?.funding_account_id ?? "",
    },
  });

  async function save(values: SipValues, close: () => void) {
    const amount = parseAmount(values.amount, holding.currency);
    if (amount === null) return;
    try {
      if (plan) {
        await updateSip.mutateAsync({
          id: plan.id,
          body: {
            amount,
            frequency: values.frequency,
            next_due_date: values.nextDueDate,
            end_date: values.endDate || null,
            funding_account_id: values.fundingAccountId || null,
          },
        });
      } else {
        await createSip.mutateAsync({
          holding_id: holding.id,
          amount,
          frequency: values.frequency,
          next_due_date: values.nextDueDate,
          end_date: values.endDate || null,
          funding_account_id: values.fundingAccountId || null,
          notes: "",
        });
      }
      onSaved(`Saved the SIP for “${holding.name}”.`);
      close();
    } catch (reason) {
      setError("root.server", { message: errorMessage(reason, "Couldn’t save the SIP.") });
    }
  }

  return (
    <DialogShell
      title={plan ? "Edit SIP" : "Schedule a SIP"}
      description={`${holding.name}. A scheduled SIP is only a plan: nothing is invested until you record an installment.`}
      busy={saving}
      onClose={onClose}
      submitLabel={plan ? "Save changes" : "Schedule SIP"}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label={`Amount (${holding.currency})`}
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          {...register("amount")}
          error={errors.amount?.message}
        />
        <SelectField label="Repeats" {...register("frequency")}>
          {FREQUENCIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <FormField
          label="Next SIP date"
          type="date"
          {...register("nextDueDate")}
          error={errors.nextDueDate?.message}
        />
        <FormField
          label="Ends (optional)"
          type="date"
          {...register("endDate")}
          error={errors.endDate?.message}
        />
        <SelectField label="Debited from (optional)" {...register("fundingAccountId")}>
          <option value="">The investment account’s cash</option>
          {cashAccounts(accounts, holding.currency, holding.account_id).map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectField>
      </div>
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

// Deposits

type DepositValues = InferType<typeof depositSchema>;

/** Opens a fixed or recurring deposit and records its first deposit. */
export function DepositDialog({
  workspaceId,
  deposit,
  investmentAccounts,
  accounts,
  onSaved,
  onClose,
}: Common & {
  deposit?: Deposit;
  investmentAccounts: readonly InvestmentAccount[];
  accounts: readonly FinanceAccount[];
}) {
  const { createDeposit, updateDeposit } = useInvestmentMutations(workspaceId);
  const usable = investmentAccounts.filter((account) => !account.archived);
  const first = deposit?.account_id ?? usable[0]?.account_id ?? "";
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<DepositValues>({
    resolver: yupResolver(depositSchema),
    defaultValues: {
      accountId: first,
      kind: deposit?.kind ?? "fixed",
      name: deposit?.name ?? "",
      institution: deposit?.institution ?? "",
      currency: deposit?.currency ?? usable[0]?.currency ?? DEFAULT_CURRENCY,
      rate: deposit ? formatRate(deposit.interest_rate_bps) : "",
      compounding: deposit?.compounding ?? "quarterly",
      startDate: deposit?.start_date ?? localDateString(),
      maturityDate: deposit?.maturity_date ?? "",
      amount: deposit
        ? toDecimalString(deposit.installment_amount ?? deposit.principal, deposit.currency)
        : "",
      statedMaturity: deposit?.stated_maturity_amount
        ? toDecimalString(deposit.stated_maturity_amount, deposit.currency)
        : "",
      settlement: "account",
      cashAccountId: usable[0]?.linked_account_id ?? "",
      notes: deposit?.notes ?? "",
      reminderDays: deposit?.reminder ? String(deposit.reminder.days_before) : "7",
      reminderTime: deposit?.reminder?.time_of_day.slice(0, 5) ?? "09:00",
    },
  });
  const accountId = useWatch({ control, name: "accountId" });
  const kind = useWatch({ control, name: "kind" });
  const settlement = useWatch({ control, name: "settlement" });
  const currency =
    usable.find((entry) => entry.account_id === accountId)?.currency ?? DEFAULT_CURRENCY;

  async function save(values: DepositValues, close: () => void) {
    const amount = parseAmount(values.amount, currency);
    const stated = values.statedMaturity ? parseAmount(values.statedMaturity, currency) : null;
    if (amount === null) return;
    const reminder = toReminderRequest(
      values.reminderDays,
      values.reminderTime,
      deposit?.reminder?.timezone ?? browserTimeZone(),
    );
    try {
      if (deposit) {
        await updateDeposit.mutateAsync({
          id: deposit.id,
          body: {
            name: values.name,
            institution: values.institution,
            interest_rate_bps: rateToBps(values.rate),
            compounding: values.compounding,
            maturity_date: values.maturityDate,
            stated_maturity_amount: stated,
            notes: values.notes,
            reminder,
            ...(deposit.kind === "recurring" ? { installment_amount: amount } : {}),
          },
        });
        onSaved(`Saved “${values.name}”.`);
      } else {
        await createDeposit.mutateAsync({
          account_id: values.accountId,
          kind: values.kind,
          name: values.name,
          institution: values.institution,
          interest_rate_bps: rateToBps(values.rate),
          compounding: values.compounding,
          start_date: values.startDate,
          maturity_date: values.maturityDate,
          amount,
          settlement: values.settlement,
          cash_account_id: values.settlement === "account" ? values.cashAccountId : null,
          stated_maturity_amount: stated,
          notes: values.notes,
          reminder,
        });
        onSaved(`Opened “${values.name}”.`);
      }
      close();
    } catch (reason) {
      setError("root.server", { message: errorMessage(reason, "Couldn’t save the deposit.") });
    }
  }

  return (
    <DialogShell
      title={deposit ? "Edit deposit" : "Open a deposit"}
      description="Interest and maturity amounts are estimates from the rate and compounding; your bank’s figures may differ."
      busy={saving}
      onClose={onClose}
      submitLabel={deposit ? "Save changes" : "Open deposit"}
      wide
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {deposit ? null : (
          <>
            <SelectField
              label="Held in"
              error={errors.accountId?.message}
              {...register("accountId")}
            >
              {usable.map((account) => (
                <option key={account.account_id} value={account.account_id}>
                  {account.name} ({account.currency})
                </option>
              ))}
            </SelectField>
            <SelectField label="Type" {...register("kind")}>
              {DEPOSIT_KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </>
        )}
        <FormField
          label="Name"
          autoComplete="off"
          autoFocus
          placeholder="SBI FD 2025"
          {...register("name")}
          error={errors.name?.message}
        />
        <FormField
          label="Bank or institution (optional)"
          autoComplete="off"
          {...register("institution")}
        />
        <FormField
          label="Interest rate (% a year)"
          inputMode="decimal"
          autoComplete="off"
          {...register("rate")}
          error={errors.rate?.message}
        />
        <SelectField label="Compounding" {...register("compounding")}>
          {COMPOUNDING.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        {deposit ? null : (
          <FormField
            label="Start date"
            type="date"
            {...register("startDate")}
            error={errors.startDate?.message}
          />
        )}
        <FormField
          label="Maturity date"
          type="date"
          {...register("maturityDate")}
          error={errors.maturityDate?.message}
        />
        {!deposit || deposit.kind === "recurring" ? (
          <FormField
            label={
              (deposit?.kind ?? kind) === "recurring"
                ? `Monthly installment (${currency})`
                : `Principal (${currency})`
            }
            inputMode="decimal"
            autoComplete="off"
            {...register("amount")}
            error={errors.amount?.message}
          />
        ) : null}
        <FormField
          label={`Maturity amount stated by the bank (${currency}, optional)`}
          inputMode="decimal"
          autoComplete="off"
          {...register("statedMaturity")}
          error={errors.statedMaturity?.message}
        />
      </div>
      {deposit ? null : (
        <SettlementFields
          settlement={settlement}
          register={register("settlement")}
          accountRegister={register("cashAccountId")}
          accounts={cashAccounts(accounts, currency, accountId)}
          allowNone
          accountError={errors.cashAccountId?.message}
          direction="in"
        />
      )}
      <ReminderFields
        days={register("reminderDays")}
        time={register("reminderTime")}
        daysError={errors.reminderDays?.message}
      />
      <NotesField register={register("notes")} />
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

type CloseValues = InferType<typeof closeDepositSchema>;
export type DepositAction = "contribute" | "value" | "close";

const ACTION_TITLES: Record<DepositAction, string> = {
  contribute: "Add money",
  value: "Set the current value",
  close: "Close the deposit",
};

/**
 * Adds money to a deposit (a recurring installment or a top-up), sets its value by hand, or
 * closes it (at maturity or early), recording the principal returned and any interest earned.
 */
export function DepositActionDialog({
  workspaceId,
  deposit,
  action,
  accounts,
  linkedAccountId,
  onSaved,
  onClose,
}: Common & {
  deposit: Deposit;
  action: DepositAction;
  accounts: readonly FinanceAccount[];
  linkedAccountId: string | null;
}) {
  const { contribute, valueDeposit, closeDeposit } = useInvestmentMutations(workspaceId);
  const currency = deposit.currency;
  const today = localDateString();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<CloseValues>({
    resolver: yupResolver(closeDepositSchema),
    defaultValues: {
      currency,
      closedOn: action === "close" && deposit.maturity_date < today ? deposit.maturity_date : today,
      amount:
        action === "contribute" && deposit.installment_amount
          ? toDecimalString(deposit.installment_amount, currency)
          : action === "value"
            ? toDecimalString(deposit.value, currency)
            : action === "close"
              ? toDecimalString(deposit.stated_maturity_amount ?? deposit.value, currency)
              : "",
      settlement: linkedAccountId ? "account" : "investment_account",
      cashAccountId: linkedAccountId ?? "",
    },
  });
  const settlement = useWatch({ control, name: "settlement" });

  async function save(values: CloseValues, close: () => void) {
    const amount = parseAmount(values.amount, currency);
    if (amount === null) return;
    const cash = values.settlement === "account" ? values.cashAccountId : null;
    const settle = values.settlement === "none" ? "investment_account" : values.settlement;
    try {
      if (action === "contribute") {
        await contribute.mutateAsync({
          id: deposit.id,
          body: {
            trade_date: values.closedOn,
            amount,
            settlement: settle,
            cash_account_id: cash,
            notes: "",
          },
        });
        onSaved(`Added ${formatMoney(amount, currency)} to “${deposit.name}”.`);
      } else if (action === "value") {
        await valueDeposit.mutateAsync({
          id: deposit.id,
          body: { value: amount, valued_on: values.closedOn },
        });
        onSaved(`Set the value of “${deposit.name}”.`);
      } else {
        await closeDeposit.mutateAsync({
          id: deposit.id,
          body: { closed_on: values.closedOn, amount, settlement: settle, cash_account_id: cash },
        });
        onSaved(`Closed “${deposit.name}”.`);
      }
      close();
    } catch (reason) {
      setError("root.server", { message: errorMessage(reason, "Couldn’t save. Try again.") });
    }
  }

  return (
    <DialogShell
      title={ACTION_TITLES[action]}
      description={
        action === "close"
          ? `${deposit.name}. Enter everything you received: above the principal of ${formatMoney(deposit.principal, currency)} is recorded as interest income.`
          : action === "value"
            ? `${deposit.name}. Your value replaces Orbit’s estimate from this date.`
            : deposit.name
      }
      busy={saving}
      onClose={onClose}
      submitLabel={action === "close" ? "Close deposit" : "Save"}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label={action === "close" ? "Closed on" : action === "value" ? "Valued on" : "Date"}
          type="date"
          {...register("closedOn")}
          error={errors.closedOn?.message}
        />
        <FormField
          label={
            action === "close"
              ? `Amount received (${currency})`
              : action === "value"
                ? `Value (${currency})`
                : `Amount (${currency})`
          }
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          {...register("amount")}
          error={errors.amount?.message}
        />
      </div>
      {action === "value" ? null : (
        <SettlementFields
          settlement={settlement}
          register={register("settlement")}
          accountRegister={register("cashAccountId")}
          accounts={cashAccounts(accounts, currency, deposit.account_id)}
          allowNone={false}
          accountError={errors.cashAccountId?.message}
          direction={action === "close" ? "out" : "in"}
        />
      )}
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}
