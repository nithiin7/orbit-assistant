"use client";

import { ArrowDown, ArrowUp, LayoutDashboard, Plus, RotateCcw, X } from "lucide-react";
import { type ComponentType, useEffect, useId, useRef, useState } from "react";

import { CalendarWidget } from "@/components/calendar/calendar-widget";
import { DocumentsWidget } from "@/components/documents/documents-widget";
import { EmptyState } from "@/components/empty-state";
import {
  BudgetWidget,
  CashFlowWidget,
  NetWorthWidget,
  SavingsGoalsWidget,
  UpcomingPaymentsWidget,
} from "@/components/finance/finance-widgets";
import {
  FitnessGoalsWidget,
  NutritionWidget,
  WaterWidget,
  WeightWidget,
  WorkoutsWidget,
} from "@/components/fitness/fitness-widgets";
import { HabitsWidget } from "@/components/habits/habits-widget";
import { NotesWidget } from "@/components/notes/notes-widget";
import { PageHeader } from "@/components/page-header";
import { PlacesWidget } from "@/components/places/places-widget";
import { ReminderOverview } from "@/components/reminders/reminder-overview";
import { SetupCard } from "@/components/setup/setup-card";
import { ShoppingOverview } from "@/components/shopping/shopping-overview";
import { StorageIndicator } from "@/components/storage/storage-indicator";
import { TaskWidget } from "@/components/tasks/task-widget";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { WatchlistWidget } from "@/components/watchlist/watchlist-widget";
import { WorkspaceOverview } from "@/components/workspace/workspace-overview";
import { useDashboardLayout } from "@/hooks/use-dashboard-layout";
import {
  addWidget,
  type DashboardWidget,
  type Density,
  findWidget,
  hiddenWidgets,
  moveWidget,
  removeWidget,
  resizeWidget,
  widgetGroups,
  type WidgetId,
  type WidgetSize,
} from "@/lib/dashboard";
import { useCurrentUser } from "@/providers/auth";
import { cn } from "@/utils/common";

import { HiddenAmountsProvider } from "./amount-visibility";
import { AttentionWidget } from "./attention-widget";
import { ModulesWidget } from "./modules-widget";
import { QuickActionsWidget } from "./quick-actions-widget";
import { StatusWidget } from "./status-widget";
import { TodayWidget } from "./today-widget";

const widgetComponents: Record<WidgetId, ComponentType> = {
  today: TodayWidget,
  quick_actions: QuickActionsWidget,
  attention: AttentionWidget,
  workspace: WorkspaceOverview,
  status: StatusWidget,
  tasks: TaskWidget,
  reminders: ReminderOverview,
  calendar: CalendarWidget,
  habits: HabitsWidget,
  notes: NotesWidget,
  documents: DocumentsWidget,
  shopping: ShoppingOverview,
  watchlist: WatchlistWidget,
  places: PlacesWidget,
  cash_flow: CashFlowWidget,
  upcoming_payments: UpcomingPaymentsWidget,
  budget: BudgetWidget,
  net_worth: NetWorthWidget,
  savings_goals: SavingsGoalsWidget,
  workouts: WorkoutsWidget,
  water: WaterWidget,
  nutrition: NutritionWidget,
  weight: WeightWidget,
  fitness_goals: FitnessGoalsWidget,
  modules: ModulesWidget,
};

// Narrow widgets share a row: two on laptops, three on very wide screens. Wide ones fill it.
const sizeLabels: Record<WidgetSize, string> = { half: "Narrow", full: "Wide" };

const densityLabels: Record<Density, string> = { comfortable: "Comfortable", compact: "Compact" };

/** The dashboard, arranged by the signed-in user. Remounts when the user changes. */
export function Dashboard() {
  const user = useCurrentUser();
  return <DashboardLayout key={user.id} userId={user.id} />;
}

function DashboardLayout({ userId }: { userId: string }) {
  const id = useId();
  const {
    layout,
    preferences,
    update: save,
    setPreferences,
    reset: resetLayout,
    saveError,
    retry,
  } = useDashboardLayout(userId);
  const [editing, setEditing] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // Reordering and removing re-render the controls, so focus is restored by element ID.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });

  const controlId = (widgetId: WidgetId, control: string) => `${id}-${widgetId}-${control}`;

  function update(next: DashboardWidget[], message: string, focusId?: string) {
    save(next);
    setAnnouncement(message);
    pendingFocus.current = focusId ?? null;
  }

  function move(widgetId: WidgetId, offset: -1 | 1) {
    const next = moveWidget(layout, widgetId, offset);
    const index = next.findIndex((widget) => widget.id === widgetId);
    // At either end the pressed button is disabled, so focus its opposite.
    const control =
      offset === -1
        ? index === 0
          ? "later"
          : "earlier"
        : index === next.length - 1
          ? "earlier"
          : "later";
    const { title } = findWidget(widgetId);
    update(
      next,
      `${title} moved to position ${index + 1} of ${next.length}.`,
      controlId(widgetId, control),
    );
  }

  function reset() {
    resetLayout();
    setAnnouncement("Dashboard reset to the default layout.");
  }

  function setDensity(density: Density) {
    setPreferences({ ...preferences, density });
    setAnnouncement(`${densityLabels[density]} layout.`);
  }

  function setHideAmounts(hideAmounts: boolean) {
    setPreferences({ ...preferences, hideAmounts });
    setAnnouncement(hideAmounts ? "Amounts hidden." : "Amounts shown.");
  }

  const hidden = hiddenWidgets(layout);

  return (
    <div className="@container/dashboard space-y-6">
      <PageHeader
        title="Dashboard"
        description="Your day across Orbit, private to you."
        actions={
          <>
            <StorageIndicator />
            <Button
              variant={editing ? "default" : "outline"}
              size="sm"
              aria-expanded={editing}
              aria-controls={`${id}-customize`}
              onClick={() => setEditing((value) => !value)}
            >
              {editing ? "Done" : "Customize"}
            </Button>
          </>
        }
      />

      <p role="status" className="sr-only">
        {announcement}
      </p>

      <SetupCard />

      {saveError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 px-5 py-3"
        >
          <p className="text-sm text-muted-foreground">{saveError}</p>
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : null}

      {editing ? (
        <section
          id={`${id}-customize`}
          aria-labelledby={`${id}-customize-heading`}
          className="space-y-4 rounded-xl border border-dashed bg-card/40 p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 id={`${id}-customize-heading`} className="text-base font-semibold">
                Customize your dashboard
              </h2>
              <p className="max-w-prose text-sm text-pretty text-muted-foreground">
                Add, remove, reorder, and resize widgets. Narrow widgets sit side by side on wide
                screens. Your layout is saved to your account, just for you.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw aria-hidden="true" />
              Reset to default
            </Button>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Display</legend>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div
                role="group"
                aria-label="Density"
                className="flex rounded-md border bg-card p-0.5"
              >
                {(["comfortable", "compact"] as const).map((density) => (
                  <Button
                    key={density}
                    variant={preferences.density === density ? "default" : "ghost"}
                    size="sm"
                    className="h-7 shadow-none"
                    aria-pressed={preferences.density === density}
                    onClick={() => setDensity(density)}
                  >
                    {densityLabels[density]}
                  </Button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={preferences.hideAmounts}
                  onChange={(event) => setHideAmounts(event.target.checked)}
                />
                Hide money amounts
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Hiding amounts shows dots in place of money on this dashboard, for screens others can
              see. Health widgets are off until you add them, and show only your own records.
            </p>
          </fieldset>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Add widgets</h3>
            {hidden.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every widget is on your dashboard.</p>
            ) : (
              widgetGroups.map((group) => {
                const inGroup = hidden.filter((widget) => widget.group === group);
                if (inGroup.length === 0) return null;
                return (
                  <div key={group} className="space-y-1.5">
                    <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {group}
                    </h4>
                    <ul className="divide-y rounded-lg border bg-card">
                      {inGroup.map((widget) => (
                        <li key={widget.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{widget.title}</p>
                            <p className="text-xs text-muted-foreground">{widget.description}</p>
                          </div>
                          <Button
                            id={`${id}-add-${widget.id}`}
                            variant="outline"
                            size="sm"
                            aria-label={`Add ${widget.title}`}
                            onClick={() =>
                              update(
                                addWidget(layout, widget.id),
                                `${widget.title} added to the end of the dashboard.`,
                                controlId(widget.id, "remove"),
                              )
                            }
                          >
                            <Plus aria-hidden="true" />
                            Add
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>
        </section>
      ) : null}

      {layout.length === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          title="Your dashboard is empty"
          description="Choose Customize to add widgets back."
        />
      ) : (
        <HiddenAmountsProvider hidden={preferences.hideAmounts}>
          <div
            data-density={preferences.density}
            className={cn(
              "grid grid-cols-1 @3xl/dashboard:grid-cols-2 @[110rem]/dashboard:grid-cols-3",
              preferences.density === "compact" ? "gap-3" : "gap-4 2xl:gap-6",
            )}
          >
            {layout.map((widget, index) => {
              const Widget = widgetComponents[widget.id];
              const { title } = findWidget(widget.id);
              return (
                <div
                  key={widget.id}
                  role={editing ? "group" : undefined}
                  aria-label={editing ? `${title} widget` : undefined}
                  className={cn(
                    "flex min-w-0 flex-col gap-2",
                    widget.size === "full" &&
                      "@3xl/dashboard:col-span-2 @[110rem]/dashboard:col-span-3",
                    editing && "rounded-xl border border-dashed p-2",
                  )}
                >
                  {editing ? (
                    <div className="flex flex-wrap items-center gap-2 px-1">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
                      <div
                        role="group"
                        aria-label={`${title} width`}
                        className="flex rounded-md border bg-card p-0.5"
                      >
                        {(["half", "full"] as const).map((size) => (
                          <Button
                            key={size}
                            variant={widget.size === size ? "default" : "ghost"}
                            size="sm"
                            className="h-7 shadow-none"
                            aria-pressed={widget.size === size}
                            onClick={() =>
                              update(
                                resizeWidget(layout, widget.id, size),
                                `${title} is now ${sizeLabels[size].toLowerCase()}.`,
                              )
                            }
                          >
                            {sizeLabels[size]}
                          </Button>
                        ))}
                      </div>
                      <Button
                        id={controlId(widget.id, "earlier")}
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Move ${title} earlier`}
                        disabled={index === 0}
                        onClick={() => move(widget.id, -1)}
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        id={controlId(widget.id, "later")}
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Move ${title} later`}
                        disabled={index === layout.length - 1}
                        onClick={() => move(widget.id, 1)}
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button
                        id={controlId(widget.id, "remove")}
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Remove ${title}`}
                        onClick={() =>
                          update(
                            removeWidget(layout, widget.id),
                            `${title} removed. You can add it back from Add widgets.`,
                            `${id}-add-${widget.id}`,
                          )
                        }
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                  <div className="min-h-0 flex-1">
                    <Widget />
                  </div>
                </div>
              );
            })}
          </div>
        </HiddenAmountsProvider>
      )}
    </div>
  );
}
