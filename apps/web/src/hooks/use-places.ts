"use client";

import type {
  CreatePlaceRequest,
  Place,
  Places,
  PlaceSettings,
  UpdatePlaceRequest,
} from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPlace,
  deletePlace,
  placeKeys,
  placeSettingsOptions,
  placesOptions,
  replaceCachedPlace,
  searchPlaces,
  updateCachedPlaces,
  updatePlace,
  updatePlaceSettings,
} from "@/api/places";
import { queryResource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";

const selectPlaces = (data: Places) => data.places;

/** The workspace's places. */
export function usePlaces(workspaceId: string) {
  const { withToken } = useAuth();
  const query = useQuery({ ...placesOptions(withToken, workspaceId), select: selectPlaces });
  useWorkspaceNotFound(query.error);
  return { places: queryResource(query, "Couldn’t load your places."), reload: query.refetch };
}

/** Adding, changing, and removing places; each updates the cached list to match. */
export function usePlaceMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const store = (place: Place) => replaceCachedPlace(queryClient, workspaceId, place);

  const add = useMutation({
    mutationFn: (body: CreatePlaceRequest) =>
      withToken((token) => createPlace(token, workspaceId, body)),
    onSuccess: store,
  });

  const update = useMutation({
    mutationFn: ({ place, changes }: { place: Place; changes: UpdatePlaceRequest }) =>
      withToken((token) => updatePlace(token, workspaceId, place.id, changes)),
    onSuccess: store,
  });

  const remove = useMutation({
    mutationFn: (place: Place) => withToken((token) => deletePlace(token, workspaceId, place.id)),
    onSuccess: (_result, place) =>
      updateCachedPlaces(queryClient, workspaceId, (places) =>
        places.filter((entry) => entry.id !== place.id),
      ),
  });

  const search = useMutation({
    mutationFn: (query: string) =>
      withToken((token) => searchPlaces(token, workspaceId, query)).then((data) => data.matches),
  });

  return { add, update, remove, search };
}

/** Whether this workspace uses online maps and place search, and the switch for it. */
export function usePlaceSettings(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery(placeSettingsOptions(withToken, workspaceId));
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      withToken((token) => updatePlaceSettings(token, workspaceId, enabled)),
    onSuccess: (settings) =>
      queryClient.setQueryData<PlaceSettings>(placeKeys.settings(workspaceId), settings),
  });
  return { settings: query.data ?? null, isError: query.isError, toggle };
}
