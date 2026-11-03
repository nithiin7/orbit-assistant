import type { SearchEntityType, UniversalSearchHit } from "@orbit/contracts";
import {
  AlarmClock,
  BookOpen,
  CalendarDays,
  CheckSquare,
  Dumbbell,
  FileLock2,
  HeartPulse,
  Landmark,
  type LucideIcon,
  NotebookPen,
  PiggyBank,
  Receipt,
  Repeat2,
  Ruler,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { Highlighted } from "@/components/notes/note-list";
import { describeHit, hitTitle, matchedIn, moduleLabel } from "@/lib/search";
import { cn } from "@/utils/common";

const ICONS: Readonly<Record<SearchEntityType, LucideIcon>> = {
  task: CheckSquare,
  note: NotebookPen,
  event: CalendarDays,
  reminder: AlarmClock,
  account: Landmark,
  transaction: Receipt,
  loan: Landmark,
  subscription: Repeat2,
  bill: Receipt,
  holding: TrendingUp,
  deposit: PiggyBank,
  asset: Wallet,
  budget: Wallet,
  savings_goal: Target,
  habit: Repeat2,
  routine: BookOpen,
  document: FileLock2,
  exercise: Dumbbell,
  workout: Dumbbell,
  workout_template: Dumbbell,
  fitness_goal: Target,
  measurement: Ruler,
};

const updatedFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

type SearchResultProps = {
  id: string;
  hit: UniversalSearchHit;
  query: string;
  active: boolean;
  /** Show which module the hit is from (on the All tab). */
  showModule: boolean;
  onOpen: () => void;
  onPoint: () => void;
};

/**
 * One result: icon, highlighted title, module, the facts that identify it, the matching
 * snippet (plain text, highlighted safely), and when it was last updated. Keyboard selection
 * is handled by the search field (`aria-activedescendant`), like the command palette.
 */
export function SearchResult({
  id,
  hit,
  query,
  active,
  showModule,
  onOpen,
  onPoint,
}: SearchResultProps) {
  const Icon = ICONS[hit.entity_type] ?? HeartPulse;
  const facts = describeHit(hit);
  const where = matchedIn(hit.matched_fields);
  return (
    <div
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={active}
      onClick={onOpen}
      onPointerMove={() => {
        if (!active) onPoint();
      }}
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border border-transparent px-3 py-3 transition-colors duration-100",
        active ? "border-border bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={cn("font-medium", !hit.active && "text-muted-foreground")}>
            <Highlighted text={hitTitle(hit)} search={query} />
          </span>
          {showModule ? (
            <span className="text-xs text-muted-foreground">in {moduleLabel(hit.module)}</span>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{facts.join(" · ")}</p>
        {hit.snippet ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            <Highlighted text={hit.snippet} search={query} />
          </p>
        ) : null}
        {where ? <p className="text-xs text-muted-foreground italic">{where}</p> : null}
      </div>
      <time
        dateTime={hit.updated_at}
        className="hidden shrink-0 text-xs text-muted-foreground sm:block"
        title="Last updated"
      >
        {updatedFormat.format(new Date(hit.updated_at))}
      </time>
    </div>
  );
}
