"use client";

import {
  ArrowLeftRight,
  CalendarClock,
  ClipboardList,
  Gem,
  Landmark,
  LayoutDashboard,
  LineChart,
  type LucideIcon,
  PiggyBank,
  Receipt,
  Repeat,
  Scale,
  Target,
  Wallet,
} from "lucide-react";
import { useId } from "react";

import { Menu } from "@/components/ui/menu";
import {
  FINANCE_VIEW_GROUPS,
  FINANCE_VIEWS,
  type FinanceView,
  type FinanceViewGroup,
  financeViewLabel,
  groupOf,
  viewsInGroup,
} from "@/lib/finance-views";
import { cn } from "@/utils/common";

export const VIEW_ICONS: Record<FinanceView, LucideIcon> = {
  overview: LayoutDashboard,
  transactions: ArrowLeftRight,
  accounts: Wallet,
  budgets: PiggyBank,
  plan: ClipboardList,
  goals: Target,
  upcoming: CalendarClock,
  loans: Landmark,
  subscriptions: Repeat,
  bills: Receipt,
  investments: LineChart,
  assets: Gem,
  "net-worth": Scale,
};

/** A number beside a view that needs attention, such as overdue payments. */
export type ViewBadges = Partial<Record<FinanceView, { count: number; label: string }>>;

type FinanceNavProps = {
  view: FinanceView;
  onChange: (view: FinanceView) => void;
  badges: ViewBadges;
};

const SECTIONS: readonly { id: FinanceViewGroup | null; label: string | null }[] = [
  { id: null, label: null },
  ...FINANCE_VIEW_GROUPS,
];

/**
 * The thirteen finance views, grouped. A sticky side rail when the page is wide; below that, a
 * picker that lists every view, and the current group's views as a row of chips.
 */
export function FinanceNav({ view, onChange, badges }: FinanceNavProps) {
  const idPrefix = useId();
  const current = groupOf(view);
  const groupLabel = FINANCE_VIEW_GROUPS.find((group) => group.id === current)?.label;
  const CurrentIcon = VIEW_ICONS[view];

  return (
    <nav aria-label="Finance views" className="min-w-0 space-y-3 @5xl/finance:space-y-5">
      <div className="@5xl/finance:hidden">
        <Menu
          variant="outline"
          aria-label={`Switch finance view, now ${financeViewLabel(view)}`}
          className="w-full justify-start"
          items={FINANCE_VIEWS.map((entry) => {
            const badge = badges[entry.id];
            return {
              id: entry.id,
              label: entry.label,
              description: badge && badge.count > 0 ? badge.label : undefined,
              icon: VIEW_ICONS[entry.id],
              group: FINANCE_VIEW_GROUPS.find((group) => group.id === entry.group)?.label,
              checked: entry.id === view,
              onSelect: () => onChange(entry.id),
            };
          })}
        >
          <CurrentIcon aria-hidden="true" className="text-brand" />
          <span className="min-w-0 flex-1 truncate text-left">
            {groupLabel ? <span className="text-muted-foreground">{groupLabel} · </span> : null}
            {financeViewLabel(view)}
          </span>
        </Menu>
      </div>

      {SECTIONS.map((section) => {
        const headingId = `${idPrefix}-${section.id ?? "top"}`;
        const views = viewsInGroup(section.id);
        // Narrow pages show only the current group's views; the picker reaches the rest. Overview
        // alone needs no row of its own there.
        const shownNarrow = section.id !== null && section.id === current;
        return (
          <div
            key={section.id ?? "top"}
            role="group"
            aria-labelledby={section.label ? headingId : undefined}
            aria-label={section.label ? undefined : "Overview"}
            className={cn(shownNarrow ? "block" : "hidden", "space-y-1 @5xl/finance:block")}
          >
            {section.label ? (
              <h3
                id={headingId}
                className="hidden px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase @5xl/finance:block"
              >
                {section.label}
              </h3>
            ) : null}
            <div className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto px-1 @5xl/finance:mx-0 @5xl/finance:flex-col @5xl/finance:overflow-visible @5xl/finance:px-0">
              {views.map((id) => (
                <ViewButton
                  key={id}
                  view={id}
                  selected={id === view}
                  badge={badges[id]}
                  onSelect={() => onChange(id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function ViewButton({
  view,
  selected,
  badge,
  onSelect,
}: {
  view: FinanceView;
  selected: boolean;
  badge: { count: number; label: string } | undefined;
  onSelect: () => void;
}) {
  const Icon = VIEW_ICONS[view];
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex h-9 shrink-0 items-center gap-2.5 rounded-full border px-3 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring @5xl/finance:w-full @5xl/finance:rounded-lg @5xl/finance:border-transparent",
        selected
          ? "border-transparent bg-brand-subtle text-brand"
          : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground @5xl/finance:bg-transparent",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="flex-1 text-left">{financeViewLabel(view)}</span>
      {badge && badge.count > 0 ? (
        // The view itself says what needs attention; this is a visual cue.
        <span
          aria-hidden="true"
          title={badge.label}
          className="min-w-6 rounded-full bg-destructive/10 px-1.5 text-center text-xs text-destructive tabular-nums"
        >
          {badge.count}
        </span>
      ) : null}
    </button>
  );
}
