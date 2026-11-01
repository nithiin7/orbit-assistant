import { cn } from "@/utils/common";
import { addDays, dayOfWeek, formatCalendarDate } from "@/utils/dates";

export type HeatCell = {
  day: string;
  /** 0 (nothing) to 4 (all done); `null` for days that don't count, such as rest days. */
  level: 0 | 1 | 2 | 3 | 4 | null;
  /** What the day was, for assistive technology and the tooltip: "Done", "2 of 3 done". */
  label: string;
};

const LEVELS = ["bg-muted", "bg-success/25", "bg-success/45", "bg-success/70", "bg-success"];

/**
 * A GitHub-style grid: a column per week (Monday first), a square per day, shaded by how much
 * was done. Days that don't count are drawn as outlines, so rest days never look like misses.
 */
export function Heatmap({ cells, label }: { cells: readonly HeatCell[]; label: string }) {
  const first = cells[0];
  if (!first) return null;
  // Pad to Monday so rows are weekdays.
  const lead = (dayOfWeek(first.day) + 6) % 7;
  const padded: (HeatCell | null)[] = [...Array<null>(lead).fill(null), ...cells];
  const weeks: (HeatCell | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

  return (
    <figure className="space-y-2">
      <div className="overflow-x-auto pb-1">
        <div role="grid" aria-label={label} className="flex w-max gap-[3px]">
          {weeks.map((week, column) => (
            <div key={column} role="row" className="grid grid-rows-7 gap-[3px]">
              {week.map((cell, row) =>
                cell ? (
                  <span
                    key={cell.day}
                    role="gridcell"
                    aria-label={`${formatCalendarDate(cell.day)}: ${cell.label}`}
                    title={`${formatCalendarDate(cell.day)}: ${cell.label}`}
                    className={cn(
                      "size-3 rounded-[3px]",
                      cell.level === null ? "border border-border" : LEVELS[cell.level],
                    )}
                  />
                ) : (
                  <span key={`pad-${column}-${row}`} aria-hidden="true" className="size-3" />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Less
        {LEVELS.map((style) => (
          <span key={style} aria-hidden="true" className={cn("size-3 rounded-[3px]", style)} />
        ))}
        More
        <span className="ml-3 inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-[3px] border border-border" />
          Not due
        </span>
      </figcaption>
    </figure>
  );
}

/** Every date from `start` to `end`, inclusive. */
export function datesBetween(start: string, end: string): string[] {
  const result: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) result.push(day);
  return result;
}
