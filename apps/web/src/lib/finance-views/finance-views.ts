/** The Finance page's views, in the order the navigation lists them. */
export const FINANCE_VIEWS = [
  { id: "overview", label: "Overview", group: null },
  { id: "transactions", label: "Transactions", group: "money" },
  { id: "accounts", label: "Accounts", group: "money" },
  { id: "budgets", label: "Budgets", group: "planning" },
  { id: "plan", label: "Plan", group: "planning" },
  { id: "goals", label: "Goals", group: "planning" },
  { id: "upcoming", label: "Upcoming", group: "commitments" },
  { id: "loans", label: "Loans", group: "commitments" },
  { id: "subscriptions", label: "Subscriptions", group: "commitments" },
  { id: "bills", label: "Bills", group: "commitments" },
  { id: "investments", label: "Investments", group: "wealth" },
  { id: "assets", label: "Assets", group: "wealth" },
  { id: "net-worth", label: "Net worth", group: "wealth" },
] as const satisfies readonly { id: string; label: string; group: string | null }[];

export type FinanceView = (typeof FINANCE_VIEWS)[number]["id"];
export type FinanceViewGroup = NonNullable<(typeof FINANCE_VIEWS)[number]["group"]>;

/** The groups the views sit in, under Overview, which summarizes them all. */
export const FINANCE_VIEW_GROUPS: readonly { id: FinanceViewGroup; label: string }[] = [
  { id: "money", label: "Money" },
  { id: "planning", label: "Planning" },
  { id: "commitments", label: "Commitments" },
  { id: "wealth", label: "Wealth" },
];

export const DEFAULT_FINANCE_VIEW: FinanceView = "overview";

/** The search parameter that holds the view, so it survives reloads and can be linked to. */
export const FINANCE_VIEW_PARAM = "view";

const VIEW_IDS: ReadonlySet<string> = new Set(FINANCE_VIEWS.map((view) => view.id));

function isFinanceView(value: string): value is FinanceView {
  return VIEW_IDS.has(value);
}

/** The view a search parameter names, or Overview for a missing or unknown one. */
export function parseFinanceView(value: string | null | undefined): FinanceView {
  return value && isFinanceView(value) ? value : DEFAULT_FINANCE_VIEW;
}

/** The link to a view. Overview is the page itself, without a parameter. */
export function financeViewHref(view: FinanceView): string {
  return view === DEFAULT_FINANCE_VIEW ? "/finance" : `/finance?${FINANCE_VIEW_PARAM}=${view}`;
}

export function financeViewLabel(view: FinanceView): string {
  return FINANCE_VIEWS.find((entry) => entry.id === view)?.label ?? "Overview";
}

/** The views in a group, or just Overview for `null`. */
export function viewsInGroup(group: FinanceViewGroup | null): FinanceView[] {
  return FINANCE_VIEWS.filter((view) => view.group === group).map((view) => view.id);
}

export function groupOf(view: FinanceView): FinanceViewGroup | null {
  return FINANCE_VIEWS.find((entry) => entry.id === view)?.group ?? null;
}
