"use client";

import type { FinanceTransaction } from "@orbit/contracts";
import { Download, Receipt, Search, SearchX, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select, type SelectItems } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useExportTransactions,
  useFinanceMutations,
  useTransactionHistory,
} from "@/hooks/use-finance";
import {
  dayLabel,
  DEFAULT_TRANSACTION_FILTERS,
  formatMoney,
  groupTransactionsByDay,
  isFiltered,
  moreFiltersCount,
  toTransactionListQuery,
  TRANSACTION_PAGE_SIZE,
  TRANSACTION_TYPES,
  type TransactionFilters,
} from "@/lib/finance";
import { byId, cn, type Option } from "@/utils/common";
import { localDateString } from "@/utils/dates";

import { rowListClassName, SectionHeading } from "./finance-meta";
import type { FinanceData } from "./finance-view";
import { LoadError } from "./panel";
import { TransactionItem } from "./transaction-item";
import { ViewHeader } from "./view-header";

const SEARCH_DELAY_MS = 250;

export function TransactionHistory({
  workspaceId,
  accounts,
  categories,
  onEditTransaction,
  onAnnounce,
}: FinanceData) {
  const id = useId();
  const [filters, setFilters] = useState<TransactionFilters>(DEFAULT_TRANSACTION_FILTERS);
  const [search, setSearch] = useState("");
  const query = useMemo(() => toTransactionListQuery(filters), [filters]);
  const { state, refreshing, reload } = useTransactionHistory(workspaceId, query);
  const { deleteTransaction } = useFinanceMutations(workspaceId);
  const exportTransactions = useExportTransactions(workspaceId);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const accountsById = useMemo(() => byId(accounts), [accounts]);
  const categoriesById = useMemo(() => byId(categories), [categories]);

  // Search follows the box after a pause, so each keystroke doesn't send a request.
  useEffect(() => {
    const next = search.trim();
    const timer = window.setTimeout(() => {
      setFilters((current) =>
        current.search === next ? current : { ...current, search: next, page: 0 },
      );
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  /** Change filters, returning to the first page. */
  const narrow = (changes: Partial<TransactionFilters>) =>
    setFilters((current) => ({ ...current, ...changes, page: 0 }));

  const remove = useCallback(
    async (transaction: FinanceTransaction) => {
      setActionError(null);
      setPending(transaction.id);
      try {
        await deleteTransaction.mutateAsync(transaction);
        onAnnounce(`Deleted “${transaction.description}”.`);
        listRef.current?.focus();
      } catch (reason) {
        setActionError(describeApiError(reason, "Couldn’t delete the transaction. Try again."));
      }
      setPending(null);
    },
    [deleteTransaction, onAnnounce],
  );

  const download = async () => {
    setActionError(null);
    setExporting(true);
    try {
      await exportTransactions({
        date_from: query.date_from,
        date_to: query.date_to,
      });
      onAnnounce("Exported transactions as CSV.");
    } catch (reason) {
      setActionError(describeApiError(reason, "Couldn’t export your transactions. Try again."));
    }
    setExporting(false);
  };

  const accountFilter = filters.accountId || undefined;
  const reversed = filters.from !== "" && filters.to !== "" && filters.to < filters.from;
  const extraFilters = moreFiltersCount(filters);
  const today = localDateString();

  return (
    <div className="space-y-5">
      <ViewHeader
        title="Transactions"
        description="Everything recorded, newest first. Choose one to change it."
        controls={
          <Button variant="outline" disabled={exporting} onClick={() => void download()}>
            <Download aria-hidden="true" />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        }
      />

      <div className="space-y-3">
        <div className="flex flex-col gap-2 @3xl/list:flex-row @3xl/list:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <label htmlFor={`${id}-search`} className="sr-only">
              Search transactions
            </label>
            <Input
              id={`${id}-search`}
              type="search"
              autoComplete="off"
              placeholder="Search descriptions and notes"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && search) {
                  event.preventDefault();
                  setSearch("");
                }
              }}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label="Type"
              className="-mx-1 scrollbar-none flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1"
            >
              {TYPE_FILTERS.map(({ value, label }) => {
                const selected = filters.type === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => narrow({ type: value })}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "border-transparent bg-primary text-primary-foreground shadow-elevation-1"
                        : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <Button
              variant={showFilters || extraFilters > 0 ? "soft" : "outline"}
              size="sm"
              aria-expanded={showFilters}
              aria-controls={`${id}-filters`}
              onClick={() => setShowFilters((value) => !value)}
              className="@6xl/list:hidden"
            >
              <SlidersHorizontal aria-hidden="true" />
              Filters
              {extraFilters > 0 ? (
                <span className="rounded-full bg-brand/15 px-1.5 text-xs tabular-nums">
                  <span className="sr-only">, </span>
                  {extraFilters}
                  <span className="sr-only"> on</span>
                </span>
              ) : null}
            </Button>
          </div>
        </div>

        {/* On narrow columns the rest of the filters open from the Filters button; wide ones
            have room to show them all the time. */}
        <div
          id={`${id}-filters`}
          className={cn(
            "grid-cols-2 gap-2 rounded-xl border bg-card/60 p-3 @2xl/list:grid-cols-3 @6xl/list:grid @6xl/list:grid-cols-5 @6xl/list:border-0 @6xl/list:bg-transparent @6xl/list:p-0",
            showFilters ? "grid" : "hidden",
          )}
        >
          <FilterSelect
            label="Account"
            value={filters.accountId}
            onChange={(accountId) => narrow({ accountId })}
            options={[
              { value: "", label: "All accounts" },
              ...accounts.map((account) => ({
                value: account.id,
                label: `${account.name}${account.archived ? " (archived)" : ""}`,
              })),
            ]}
          />
          <FilterSelect
            label="Category"
            value={filters.categoryId}
            onChange={(categoryId) => narrow({ categoryId })}
            options={[
              { value: "", label: "All categories" },
              ...(["expense", "income"] as const).map((type) => ({
                label: type === "income" ? "Income" : "Expenses",
                options: categories
                  .filter((category) => category.type === type)
                  .map((category) => ({ value: category.id, label: category.name })),
              })),
            ]}
          />
          <DateFilter
            label="From"
            value={filters.from}
            onChange={(value) => narrow({ from: value })}
          />
          <DateFilter
            label="To"
            value={filters.to}
            invalid={reversed}
            onChange={(value) => narrow({ to: value })}
          />
          <FilterSelect
            label="Sort by"
            value={filters.sort}
            onChange={(sort) => narrow({ sort })}
            options={SORT_OPTIONS}
          />
        </div>
        {reversed ? (
          <p className="text-xs font-medium text-destructive">
            The end date is before the start date, so it’s ignored.
          </p>
        ) : null}
      </div>

      {actionError ? <FormAlert message={actionError} /> : null}

      <div
        ref={listRef}
        tabIndex={-1}
        aria-busy={state.status === "loading" || refreshing}
        className="rounded-xl outline-none"
      >
        {state.status === "loading" ? (
          <HistorySkeleton />
        ) : state.status === "error" ? (
          <LoadError message={state.message} onRetry={reload} />
        ) : state.data.transactions.length === 0 ? (
          isFiltered(filters) ? (
            <EmptyState
              icon={SearchX}
              title="No matching transactions"
              description="Nothing matches these filters. Try other words or dates, or clear the filters."
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setFilters(DEFAULT_TRANSACTION_FILTERS);
                }}
              >
                Clear filters
              </Button>
            </EmptyState>
          ) : (
            <EmptyState
              icon={Receipt}
              title="No transactions yet"
              description="Record income, an expense, or a transfer from the Record menu. Balances and reports update as you go."
            />
          )
        ) : (
          <div
            className={cn("space-y-5 transition-opacity duration-150", refreshing && "opacity-70")}
          >
            {filters.sort === "date" ? (
              // Days, newest first, each with its net. On very wide lists the days flow into two
              // columns, read down the first and then the second, like the task board.
              <div className="gap-6 @6xl/list:columns-2">
                {groupTransactionsByDay(state.data.transactions, accountFilter).map((day) => {
                  const label = dayLabel(day.date, today);
                  const count = `${day.transactions.length} ${day.transactions.length === 1 ? "transaction" : "transactions"}`;
                  return (
                    <section
                      key={day.date}
                      aria-labelledby={`${id}-${day.date}`}
                      className="mb-4 break-inside-avoid space-y-1.5 last:mb-0"
                    >
                      <SectionHeading
                        id={`${id}-${day.date}`}
                        tone={day.date === today ? "brand" : "default"}
                        trailing={
                          day.net !== null && day.currency && day.net !== 0 ? (
                            <>
                              <span className="sr-only">Net </span>
                              {formatMoney(day.net, day.currency, { signDisplay: "always" })}
                            </>
                          ) : null
                        }
                      >
                        {label}
                      </SectionHeading>
                      <ul aria-label={`${label}, ${count}`} className={rowListClassName}>
                        {day.transactions.map(renderRow)}
                      </ul>
                    </section>
                  );
                })}
              </div>
            ) : (
              <ul
                aria-label={`${state.data.total} ${state.data.total === 1 ? "transaction" : "transactions"}, largest first`}
                className={rowListClassName}
              >
                {state.data.transactions.map((transaction) => renderRow(transaction))}
              </ul>
            )}
            <Pager
              page={filters.page}
              shown={state.data.transactions.length}
              total={state.data.total}
              onPage={(page) => setFilters((current) => ({ ...current, page }))}
            />
          </div>
        )}
      </div>
    </div>
  );

  function renderRow(transaction: FinanceTransaction) {
    return (
      <TransactionItem
        key={transaction.id}
        transaction={transaction}
        accounts={accountsById}
        categories={categoriesById}
        accountId={accountFilter}
        showDate={filters.sort !== "date"}
        pending={pending === transaction.id}
        onEdit={onEditTransaction}
        onDelete={remove}
      />
    );
  }
}

const TYPE_FILTERS: readonly Option<TransactionFilters["type"]>[] = [
  { value: "all", label: "All" },
  ...TRANSACTION_TYPES,
];

const SORT_OPTIONS: readonly Option<TransactionFilters["sort"]>[] = [
  { value: "date", label: "Newest first" },
  { value: "amount", label: "Largest first" },
];

function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: SelectItems<T>;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-xs text-muted-foreground">
        {label}
      </label>
      <Select id={id} value={value} onValueChange={onChange} options={options} />
    </div>
  );
}

function DateFilter({
  label,
  value,
  invalid = false,
  onChange,
}: {
  label: string;
  value: string;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-xs text-muted-foreground">
        {label}
      </label>
      <DatePicker
        id={id}
        value={value}
        onValueChange={onChange}
        placeholder="Any date"
        clearable
        aria-invalid={invalid || undefined}
      />
    </div>
  );
}

function Pager({
  page,
  shown,
  total,
  onPage,
}: {
  page: number;
  shown: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const first = page * TRANSACTION_PAGE_SIZE + 1;
  const last = page * TRANSACTION_PAGE_SIZE + shown;
  const hasMore = last < total;
  return (
    <nav
      aria-label="Transaction pages"
      className="flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground"
    >
      <span>
        {total > TRANSACTION_PAGE_SIZE
          ? `${first}–${last} of ${total}`
          : `${total} ${total === 1 ? "transaction" : "transactions"}`}
      </span>
      {total > TRANSACTION_PAGE_SIZE ? (
        <span className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => onPage(page + 1)}>
            Next
          </Button>
        </span>
      ) : null}
    </nav>
  );
}

function HistorySkeleton() {
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-card">
      <span className="sr-only">Loading transactions…</span>
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className={cn("h-4", row % 2 ? "w-1/3" : "w-1/2")} />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
