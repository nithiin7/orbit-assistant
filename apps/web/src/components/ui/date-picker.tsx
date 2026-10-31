"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  type FocusEvent,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { popupClassName, triggerClassName } from "@/components/ui/select";
import { POPOVER_MODE, useAnchoredPopover } from "@/hooks/use-anchored-popover";
import { cn, mergeRefs } from "@/utils/common";
import {
  addDays,
  addMonths,
  calendarWeeks,
  dayOfWeek,
  firstDayOfWeek,
  formatCalendarDate,
  localDateString,
  monthLabel,
  parseCalendarDate,
} from "@/utils/dates";

export type DatePickerProps = {
  /** `YYYY-MM-DD`, or `""` for no date. */
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  ref?: Ref<HTMLButtonElement>;
  placeholder?: string;
  /** Offer a Clear button that sets `""`. */
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  onBlur?: () => void;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

type View = "days" | "months" | "years";

const YEARS_PER_PAGE = 12;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function utc(value: string): Date {
  const { year, month, day } = parseCalendarDate(value);
  return new Date(Date.UTC(year, month - 1, day));
}

const fullDate = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const shortWeekday = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
const longWeekday = new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" });

/** `date` moved to `year`, keeping the month and, where it exists, the day. */
function withYear(date: string, year: number): string {
  return addMonths(date, (year - parseCalendarDate(date).year) * 12);
}

/**
 * A date field with a calendar popup. The trigger shows the chosen date; the popup is a
 * non-modal dialog with a day grid (arrow keys move by day and week, Page Up/Down by month,
 * with Shift by year, Home/End to the week's ends) and month and year views reached from its
 * heading. Escape closes it and returns focus to the trigger.
 */
export function DatePicker({
  value,
  onValueChange,
  id,
  ref,
  placeholder = "Pick a date",
  clearable = false,
  disabled,
  className,
  onBlur,
  ...aria
}: DatePickerProps) {
  const baseId = useId();
  const dialogId = `${baseId}-calendar`;
  const headingId = `${baseId}-heading`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("days");
  /** The day with keyboard focus; its month (or year, or page of years) is the one shown. */
  const [focused, setFocused] = useState(() => localDateString());
  const hasValue = DATE_PATTERN.test(value);
  const today = localDateString();
  const firstDay = useMemo(() => firstDayOfWeek(), []);

  useAnchoredPopover(open, triggerRef, popupRef);

  // Focus the focused day (or month, or year) on opening and as keys move it. A header button
  // keeps focus, so its arrows can be pressed repeatedly.
  useEffect(() => {
    const popup = popupRef.current;
    if (!open || !popup) return;
    const current = document.activeElement;
    if (current instanceof HTMLElement && popup.contains(current) && !current.dataset.cell) return;
    popup.querySelector<HTMLElement>("[data-focus-target]")?.focus();
  }, [open, view, focused]);

  function show() {
    setFocused(hasValue ? value : today);
    setView("days");
    setOpen(true);
  }

  function close({ returnFocus = true } = {}) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function choose(date: string) {
    if (date !== value) onValueChange(date);
    close();
  }

  function onPopupKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    // Close only the calendar, not a dialog around it.
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  function onPopupBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && (popupRef.current?.contains(next) || next === triggerRef.current)) {
      return;
    }
    close({ returnFocus: false });
    onBlur?.();
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    const weekday = (dayOfWeek(focused) - firstDay + 7) % 7;
    const moves: Partial<Record<string, string>> = {
      ArrowLeft: addDays(focused, -1),
      ArrowRight: addDays(focused, 1),
      ArrowUp: addDays(focused, -7),
      ArrowDown: addDays(focused, 7),
      Home: addDays(focused, -weekday),
      End: addDays(focused, 6 - weekday),
      PageUp: addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: addMonths(focused, event.shiftKey ? 12 : 1),
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setFocused(next);
  }

  const { year, month } = parseCalendarDate(focused);
  const yearPageStart = year - (((year % YEARS_PER_PAGE) + YEARS_PER_PAGE) % YEARS_PER_PAGE);
  const weekdays = calendarWeeks(focused.slice(0, 7), firstDay)[0] ?? [];

  const heading =
    view === "days"
      ? monthLabel(focused.slice(0, 7))
      : view === "months"
        ? String(year)
        : `${yearPageStart} – ${yearPageStart + YEARS_PER_PAGE - 1}`;
  const step = {
    days: { label: "month", move: (delta: number) => setFocused(addMonths(focused, delta)) },
    months: { label: "year", move: (delta: number) => setFocused(addMonths(focused, delta * 12)) },
    years: {
      label: `${YEARS_PER_PAGE} years`,
      move: (delta: number) => setFocused(withYear(focused, year + delta * YEARS_PER_PAGE)),
    },
  }[view];

  return (
    <div data-slot="date-picker" className={cn("relative min-w-0", className)}>
      <button
        ref={mergeRefs(ref, triggerRef)}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            show();
          }
        }}
        onBlur={(event) => {
          // Focus moving into the calendar keeps the field "in use".
          if (
            event.relatedTarget instanceof Node &&
            popupRef.current?.contains(event.relatedTarget)
          )
            return;
          if (!open) onBlur?.();
        }}
        className={triggerClassName}
        {...aria}
      >
        <span className={cn("truncate", !hasValue && "text-muted-foreground")}>
          {hasValue ? formatCalendarDate(value) : placeholder}
        </span>
        <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <div
          ref={popupRef}
          id={dialogId}
          popover={POPOVER_MODE}
          role="dialog"
          aria-labelledby={headingId}
          tabIndex={-1}
          onKeyDown={onPopupKeyDown}
          onBlur={onPopupBlur}
          className={cn(popupClassName, "w-72 p-3 outline-none")}
        >
          <div className="mb-2 flex items-center justify-between gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Previous ${step.label}`}
              onClick={() => step.move(-1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <button
              type="button"
              id={headingId}
              aria-live="polite"
              aria-disabled={view === "years"}
              onClick={() => {
                if (view !== "years") setView(view === "days" ? "months" : "years");
              }}
              className="rounded-md px-2 py-1 text-sm font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
            >
              {heading}
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Next ${step.label}`}
              onClick={() => step.move(1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>

          {view === "days" ? (
            <table
              role="grid"
              aria-labelledby={headingId}
              onKeyDown={onGridKeyDown}
              className="w-full border-collapse"
            >
              <thead>
                <tr>
                  {weekdays.map((day) => (
                    <th
                      key={day}
                      scope="col"
                      abbr={longWeekday.format(utc(day))}
                      className="pb-1 text-center text-xs font-medium text-muted-foreground"
                    >
                      {shortWeekday.format(utc(day)).slice(0, 2)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calendarWeeks(focused.slice(0, 7), firstDay).map((week) => (
                  <tr key={week[0]}>
                    {week.map((day) => {
                      const outside = parseCalendarDate(day).month !== month;
                      const isSelected = hasValue && day === value;
                      const isFocused = day === focused;
                      return (
                        <td key={day} className="p-0.5 text-center">
                          <button
                            type="button"
                            tabIndex={isFocused ? 0 : -1}
                            data-cell="day"
                            data-focus-target={isFocused ? "" : undefined}
                            aria-label={fullDate.format(utc(day))}
                            aria-pressed={isSelected}
                            aria-current={day === today ? "date" : undefined}
                            onClick={() => choose(day)}
                            className={cn(
                              "relative inline-flex size-8 items-center justify-center rounded-md text-sm tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                              outside && "text-muted-foreground/60",
                              day === today &&
                                !isSelected &&
                                "font-semibold text-brand after:absolute after:bottom-1 after:size-1 after:rounded-full after:bg-brand",
                              isSelected &&
                                "bg-primary font-medium text-primary-foreground hover:bg-primary/90",
                            )}
                          >
                            {parseCalendarDate(day).day}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {(view === "months"
                ? Array.from({ length: 12 }, (_, index) => ({
                    key: index + 1,
                    label: monthLabel(`${year}-${String(index + 1).padStart(2, "0")}`, {
                      short: true,
                    }),
                    current: index + 1 === month,
                    pick: () => {
                      setFocused(addMonths(focused, index + 1 - month));
                      setView("days");
                    },
                  }))
                : Array.from({ length: YEARS_PER_PAGE }, (_, index) => ({
                    key: yearPageStart + index,
                    label: String(yearPageStart + index),
                    current: yearPageStart + index === year,
                    pick: () => {
                      setFocused(withYear(focused, yearPageStart + index));
                      setView("months");
                    },
                  }))
              ).map((cell) => (
                <button
                  key={cell.key}
                  type="button"
                  data-cell={view}
                  data-focus-target={cell.current ? "" : undefined}
                  aria-pressed={cell.current}
                  onClick={cell.pick}
                  className={cn(
                    "h-9 rounded-md text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    cell.current && "bg-brand-subtle font-medium text-brand",
                  )}
                >
                  {cell.label}
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <Button variant="ghost" size="sm" onClick={() => choose(today)}>
              Today
            </Button>
            {clearable && hasValue ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => choose("")}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
