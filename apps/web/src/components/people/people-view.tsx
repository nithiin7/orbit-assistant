"use client";

import type { Person, PersonRelationship } from "@orbit/contracts";
import { CalendarHeart, Plus, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePeople, usePeopleMutations } from "@/hooks/use-people";
import {
  changesOf,
  createRequestOf,
  localToday,
  newPersonValues,
  parsePeopleView,
  PEOPLE_VIEWS,
  peopleHref,
  type PeopleView,
  type PersonValues,
  personValues,
  upcomingDates,
} from "@/lib/people";
import { useWorkspaces } from "@/providers/workspace";
import { browserTimeZone } from "@/utils/time-zones";

import { EveryoneList, type PersonActions, UpcomingList } from "./people-lists";
import { PeopleNav, VIEW_ICONS } from "./people-nav";
import { PersonDetail } from "./person-detail";
import { PersonDialog } from "./person-dialog";

const DESCRIPTION =
  "The people who matter, their birthdays and anniversaries, and a nudge before each one.";

/** The People page for the active workspace. Remounts (and resets) when the workspace changes. */
export function PeoplePanel() {
  const { state, refresh } = useWorkspaces();
  const params = useSearchParams();
  const view = parsePeopleView(params);

  if (state.status === "error") {
    return (
      <Shell view={view}>
        <LoadError message={state.message} onRetry={refresh} />
      </Shell>
    );
  }
  if (state.status === "loading") {
    return (
      <Shell view={view}>
        <PageSkeleton />
      </Shell>
    );
  }
  return (
    <PeoplePage
      key={state.active.id}
      workspaceId={state.active.id}
      view={view}
      openId={params.get("person")}
    />
  );
}

type Dialog = { kind: "add" } | { kind: "edit"; id: string };

function PeoplePage({
  workspaceId,
  view,
  openId,
}: {
  workspaceId: string;
  view: PeopleView;
  /** The person shown in detail, from `?person=`. */
  openId: string | null;
}) {
  const router = useRouter();
  const { people, reload } = usePeople(workspaceId);
  const mutations = usePeopleMutations(workspaceId);
  const { confirm, confirmDialog } = useConfirm();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [query, setQuery] = useState("");
  const [relationship, setRelationship] = useState<PersonRelationship | "all">("all");

  const today = localToday();
  const all = people.status === "success" ? people.data : [];
  const editing = dialog?.kind === "edit" ? all.find((person) => person.id === dialog.id) : null;
  const opened = openId ? (all.find((person) => person.id === openId) ?? null) : null;

  const open = (person: Person) => router.replace(peopleHref(view, person.id), { scroll: false });
  const closeDetail = () => router.replace(peopleHref(view), { scroll: false });

  const addAction = (
    <Button onClick={() => setDialog({ kind: "add" })}>
      <Plus aria-hidden="true" />
      Add a person
    </Button>
  );

  async function save(values: PersonValues) {
    if (dialog?.kind === "edit" && editing) {
      const changes = changesOf(editing, values);
      if (changes) await mutations.update.mutateAsync({ person: editing, changes });
      setAnnouncement(`Saved ${values.name.trim()}.`);
    } else {
      await mutations.add.mutateAsync(createRequestOf(values, browserTimeZone()));
      setAnnouncement(`Added ${values.name.trim()}.`);
    }
  }

  async function toggleFavorite(person: Person) {
    setError(null);
    try {
      await mutations.update.mutateAsync({ person, changes: { favorite: !person.favorite } });
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t update this person. Try again."));
    }
  }

  function remove(person: Person) {
    void confirm({
      title: `Delete ${person.name}?`,
      description: "Their dates, reminder, and note are removed from Orbit.",
      confirmLabel: "Delete",
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      setError(null);
      try {
        await mutations.remove.mutateAsync(person);
        setAnnouncement(`Deleted ${person.name}.`);
      } catch (reason) {
        setError(describeApiError(reason, "Couldn’t delete this person. Try again."));
      }
    });
  }

  const actions: PersonActions = {
    open,
    edit: (person) => setDialog({ kind: "edit", id: person.id }),
    toggleFavorite: (person) => void toggleFavorite(person),
    remove,
  };

  const counts =
    people.status === "success"
      ? { everyone: all.length, upcoming: upcomingDates(all, today, 30).length }
      : null;

  let content: ReactNode;
  if (people.status === "loading") content = <PageSkeleton />;
  else if (people.status === "error") {
    content = <LoadError message={people.message} onRetry={() => void reload()} />;
  } else if (all.length === 0) {
    content = (
      <EmptyState
        icon={Users}
        title="Keep your people close"
        description="Add the people who matter with their birthdays and anniversaries. Orbit reminds you before each one, so nothing slips by."
      >
        {addAction}
      </EmptyState>
    );
  } else if (view === "upcoming") {
    content = all.some((person) => person.dates.length > 0) ? (
      <UpcomingList people={all} today={today} onOpen={open} />
    ) : (
      <EmptyState
        icon={CalendarHeart}
        title="No dates yet"
        description="Add a birthday or an anniversary to someone, and it shows up here with a countdown."
      />
    );
  } else {
    content = (
      <EveryoneList
        people={all}
        today={today}
        query={query}
        relationship={relationship}
        onQuery={setQuery}
        onRelationship={setRelationship}
        actions={actions}
      />
    );
  }

  return (
    <Shell view={view} counts={counts} actions={addAction}>
      <FormAlert message={error} />
      {content}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {opened && dialog === null ? (
        <PersonDetail
          key={opened.id}
          person={opened}
          today={today}
          onEdit={() => setDialog({ kind: "edit", id: opened.id })}
          onDelete={() => remove(opened)}
          onClose={closeDetail}
        />
      ) : null}
      {dialog && (dialog.kind === "add" || editing) ? (
        <PersonDialog
          mode={dialog.kind === "add" ? "add" : "edit"}
          initial={editing ? personValues(editing) : newPersonValues()}
          timezone={editing?.timezone ?? browserTimeZone()}
          onSave={save}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {confirmDialog}
    </Shell>
  );
}

// Layout

function Shell({
  view,
  counts = null,
  actions,
  children,
}: {
  view: PeopleView;
  counts?: Partial<Record<PeopleView, number>> | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const Icon = VIEW_ICONS[view];
  const title = PEOPLE_VIEWS.find((option) => option.value === view)?.label ?? "";
  return (
    <div className="space-y-8">
      <PageHeader title="People" description={DESCRIPTION} actions={actions} />
      {/* Layout follows the space the page gets (which depends on the app sidebar), not the screen. */}
      <div className="@container/people">
        <div className="grid gap-6 @5xl/people:grid-cols-[13rem_minmax(0,1fr)] @5xl/people:gap-8 @7xl/people:grid-cols-[15rem_minmax(0,1fr)] @7xl/people:gap-12">
          <aside className="min-w-0 @5xl/people:sticky @5xl/people:top-6 @5xl/people:self-start">
            <PeopleNav view={view} counts={counts} />
          </aside>
          <div key={view} className="min-w-0 animate-page-in space-y-5">
            <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold tracking-tight">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{title}</span>
            </h2>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
      <p>{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <span className="sr-only">Loading your people…</span>
      <Skeleton className="h-10 w-full max-w-sm rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
    </div>
  );
}
