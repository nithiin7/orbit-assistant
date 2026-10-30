"use client";

import type { FinanceTransaction } from "@orbit/contracts";
import { Download, Receipt, Search, SearchX } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useExportTransactions,
  useFinanceMutations,
  useTransactionHistory,
} from "@/hooks/use-finance";
import {
  DEFAULT_TRANSACTION_FILTERS,
  isFiltered,
  isTransactionType,
  toTransactionListQuery,
  TRANSACTION_PAGE_SIZE,
  TRANSACTION_TYPES,
  type TransactionFilters,
} from "@/lib/finance";
import { byId, cn } from "@/utils/common";

import type { FinanceData } from "./finance-view";
import { TransactionItem } from "./transaction-item";

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

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3">
      <h2 id={`${id}-heading`} className="sr-only">
        Transaction history
      </h2>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
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
          <Button variant="outline" disabled={exporting} onClick={() => void download()}>
            <Download aria-hidden="true" />
            <span className="hidden sm:inline">{exporting ? "Exporting…" : "Export CSV"}</span>
            <span className="sr-only sm:hidden">Export CSV</span>
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <FilterSelect
            label="Type"
            value={filters.type}
            onChange={(value) => {
              if (value === "all" || isTransactionType(value)) narrow({ type: value });
            }}
          >
            <option value="all">All types</option>
            {TRANSACTION_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Account"
            value={filters.accountId}
            onChange={(value) => narrow({ accountId: value })}
          >
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.archived ? " (archived)" : ""}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Category"
            value={filters.categoryId}
            onChange={(value) => narrow({ categoryId: value })}
          >
            <option value="">All categories</option>
            {(["expense", "income"] as const).map((type) => (
              <optgroup key={type} label={type === "income" ? "Income" : "Expenses"}>
                {categories
                  .filter((category) => category.type === type)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </FilterSelect>
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
            onChange={(value) => {
              if (value === "date" || value === "amount") narrow({ sort: value });
            }}
          >
            <option value="date">Newest first</option>
            <option value="amount">Largest first</option>
          </FilterSelect>
        </div>
        {reversed ? (
          <p className="text-xs font-medium text-destructive">
            The end date is before the start date, so it’s ignored.
          </p>
        ) : null}
      </div>

      <FormAlert message={actionError} />

      <div
        ref={listRef}
        tabIndex={-1}
        aria-busy={state.status === "loading" || refreshing}
        className="rounded-xl outline-none"
      >
        {state.status === "loading" ? (
          <HistorySkeleton />
        ) : state.status === "error" ? (
          <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
            <p>{state.message}</p>
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </div>
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
              description="Record income, an expense, or a transfer with the buttons above. Balances and reports update as you go."
            />
          )
        ) : (
          <div className="space-y-2">
            <ul
              aria-label={`${state.data.total} ${state.data.total === 1 ? "transaction" : "transactions"}`}
              className={cn(
                "divide-y overflow-hidden rounded-xl border bg-card shadow-elevation-1 transition-opacity duration-150",
                refreshing && "opacity-70",
              )}
            >
              {state.data.transactions.map((transaction) => (
                <TransactionItem
                  key={transaction.id}
                  transaction={transaction}
                  accounts={accountsById}
                  categories={categoriesById}
                  accountId={accountFilter}
                  pending={pending === transaction.id}
                  onEdit={onEditTransaction}
                  onDelete={remove}
                />
              ))}
            </ul>
            <Pager
              page={filters.page}
              shown={state.data.transactions.length}
              total={state.data.total}
              onPage={(page) => setFilters((current) => ({ ...current, page }))}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-xs text-muted-foreground">
        {label}
      </label>
      <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </NativeSelect>
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
      <Input
        id={id}
        type="date"
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
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
    <div className="divide-y rounded-xl border bg-card">
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
