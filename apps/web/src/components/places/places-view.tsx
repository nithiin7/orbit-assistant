"use client";

import type { Place } from "@orbit/contracts";
import { Earth, PartyPopper, Plus, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlaceMutations, usePlaces, usePlaceSettings } from "@/hooks/use-places";
import {
  changesOf,
  createRequestOf,
  newPlaceValues,
  parsePlacesView,
  PLACES_VIEWS,
  type PlacesView,
  type PlaceValues,
  placeValues,
  visitMessage,
} from "@/lib/places";
import { useWorkspaces } from "@/providers/workspace";

import { MarkVisitedDialog } from "./mark-visited-dialog";
import { PlaceDialog } from "./place-dialog";
import { type PlaceActions, VisitedList, WishList } from "./place-lists";
import { PlacesNav, VIEW_ICONS } from "./places-nav";
import { WorldOverview } from "./world-overview";

const DESCRIPTION = "Where you’ve been and where you want to go, on a map of your world.";

/** The Places page for the active workspace. Remounts (and resets) when the workspace changes. */
export function PlacesPanel() {
  const { state, refresh } = useWorkspaces();
  const view = parsePlacesView(useSearchParams());

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
  return <PlacesPage key={state.active.id} workspaceId={state.active.id} view={view} />;
}

type Dialog =
  | { kind: "add"; status: Place["status"] }
  | { kind: "edit"; id: string }
  | { kind: "visited"; id: string };

function PlacesPage({ workspaceId, view }: { workspaceId: string; view: PlacesView }) {
  const { places, reload } = usePlaces(workspaceId);
  const { settings } = usePlaceSettings(workspaceId);
  const mutations = usePlaceMutations(workspaceId);
  const { confirm, confirmDialog } = useConfirm();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [celebration, setCelebration] = useState<string | null>(null);

  const online = settings?.online_maps === true;
  const styleUrl = online ? (settings?.map_style_url ?? null) : null;
  const all = places.status === "success" ? places.data : [];
  const editing = dialog?.kind === "edit" ? all.find((place) => place.id === dialog.id) : null;
  const visiting = dialog?.kind === "visited" ? all.find((place) => place.id === dialog.id) : null;

  const addAction = (
    <Button
      onClick={() =>
        setDialog({ kind: "add", status: view === "wishlist" ? "want_to_visit" : "visited" })
      }
    >
      <Plus aria-hidden="true" />
      Add a place
    </Button>
  );

  async function save(values: PlaceValues) {
    if (dialog?.kind === "edit" && editing) {
      const changes = changesOf(editing, values);
      if (changes) await mutations.update.mutateAsync({ place: editing, changes });
      setAnnouncement(`Saved ${values.name.trim()}.`);
    } else {
      await mutations.add.mutateAsync(createRequestOf(values));
      setAnnouncement(`Added ${values.name.trim()}.`);
    }
  }

  async function markVisited(place: Place, visitedOn: string | null) {
    const message = visitMessage(all, place);
    await mutations.update.mutateAsync({
      place,
      changes: { status: "visited", visited_on: visitedOn },
    });
    setCelebration(message);
    setAnnouncement(`${place.name} moved to Visited.`);
  }

  async function toggleFavorite(place: Place) {
    setError(null);
    try {
      await mutations.update.mutateAsync({ place, changes: { favorite: !place.favorite } });
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t update the place. Try again."));
    }
  }

  function remove(place: Place) {
    void confirm({
      title: `Delete “${place.name}”?`,
      description: "The place and its note are removed from Orbit.",
      confirmLabel: "Delete",
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      setError(null);
      try {
        await mutations.remove.mutateAsync(place);
        setAnnouncement(`Deleted ${place.name}.`);
      } catch (reason) {
        setError(describeApiError(reason, "Couldn’t delete the place. Try again."));
      }
    });
  }

  const actions: PlaceActions = {
    edit: (place) => setDialog({ kind: "edit", id: place.id }),
    markVisited: (place) => setDialog({ kind: "visited", id: place.id }),
    toggleFavorite: (place) => void toggleFavorite(place),
    remove,
  };

  const counts =
    places.status === "success"
      ? {
          visited: all.filter((place) => place.status === "visited").length,
          wishlist: all.filter((place) => place.status === "want_to_visit").length,
        }
      : null;

  let content: ReactNode;
  if (places.status === "loading") content = <PageSkeleton />;
  else if (places.status === "error") {
    content = <LoadError message={places.message} onRetry={() => void reload()} />;
  } else if (all.length === 0) {
    content = (
      <EmptyState
        icon={Earth}
        title="Start your map"
        description="Add the places you’ve been, and the ones you dream about. Each country you visit lights up."
      >
        {addAction}
      </EmptyState>
    );
  } else if (view === "overview") {
    content = (
      <WorldOverview
        places={all}
        styleUrl={styleUrl}
        online={online}
        onSelectPlace={(id) => setDialog({ kind: "edit", id })}
      />
    );
  } else {
    content =
      view === "visited" ? (
        <VisitedList places={all} actions={actions} />
      ) : (
        <WishList places={all} actions={actions} />
      );
  }

  return (
    <Shell view={view} counts={counts} actions={addAction}>
      <FormAlert message={error} />
      {celebration ? (
        <div className="flex animate-page-in items-center gap-3 rounded-2xl border border-brand/20 bg-linear-to-r from-brand-subtle to-transparent px-4 py-3">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground"
          >
            <PartyPopper className="size-4" />
          </span>
          <p className="flex-1 text-sm font-medium">{celebration}</p>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Dismiss"
            onClick={() => setCelebration(null)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      {content}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {visiting ? (
        <MarkVisitedDialog
          place={visiting}
          onConfirm={(visitedOn) => markVisited(visiting, visitedOn)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog && (dialog.kind === "add" || editing) ? (
        <PlaceDialog
          mode={dialog.kind === "add" ? "add" : "edit"}
          initial={
            editing
              ? placeValues(editing)
              : newPlaceValues(dialog.kind === "add" ? dialog.status : undefined)
          }
          onSearch={online ? (query) => mutations.search.mutateAsync(query) : undefined}
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
  view: PlacesView;
  counts?: Partial<Record<PlacesView, number>> | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const Icon = VIEW_ICONS[view];
  const title = PLACES_VIEWS.find((option) => option.value === view)?.label ?? "";
  return (
    <div className="space-y-8">
      <PageHeader title="Places" description={DESCRIPTION} actions={actions} />
      {/* Layout follows the space the page gets (which depends on the app sidebar), not the screen. */}
      <div className="@container/places">
        <div className="grid gap-6 @5xl/places:grid-cols-[13rem_minmax(0,1fr)] @5xl/places:gap-8 @7xl/places:grid-cols-[15rem_minmax(0,1fr)] @7xl/places:gap-12">
          <aside className="min-w-0 @5xl/places:sticky @5xl/places:top-6 @5xl/places:self-start">
            <PlacesNav view={view} counts={counts} />
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
      <span className="sr-only">Loading your places…</span>
      <Skeleton className="h-36 w-full rounded-2xl" />
      <Skeleton className="aspect-[16/9] w-full rounded-2xl" />
    </div>
  );
}
