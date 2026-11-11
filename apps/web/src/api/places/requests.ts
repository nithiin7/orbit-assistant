import type {
  CreatePlaceRequest,
  Place,
  PlaceMatches,
  Places,
  PlaceSettings,
  UpdatePlaceRequest,
} from "@orbit/contracts";

import { request, type Signal, workspacePath } from "../client";

function placesPath(workspaceId: string, suffix: string): string {
  return workspacePath(workspaceId, `/places${suffix}`);
}

function itemPath(workspaceId: string, placeId: string): string {
  return placesPath(workspaceId, `/items/${encodeURIComponent(placeId)}`);
}

/** Every place, newest first. */
export function listPlaces(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<Places> {
  return request<Places>(placesPath(workspaceId, "/items"), { token, signal });
}

export function createPlace(
  token: string,
  workspaceId: string,
  body: CreatePlaceRequest,
): Promise<Place> {
  return request<Place>(placesPath(workspaceId, "/items"), { method: "POST", body, token });
}

export function updatePlace(
  token: string,
  workspaceId: string,
  placeId: string,
  body: UpdatePlaceRequest,
): Promise<Place> {
  return request<Place>(itemPath(workspaceId, placeId), { method: "PATCH", body, token });
}

export function deletePlace(token: string, workspaceId: string, placeId: string) {
  return request<void>(itemPath(workspaceId, placeId), { method: "DELETE", token });
}

/** Look a place up by name. Only works with online maps on. */
export function searchPlaces(
  token: string,
  workspaceId: string,
  query: string,
): Promise<PlaceMatches> {
  return request<PlaceMatches>(placesPath(workspaceId, "/search"), {
    method: "POST",
    body: { query },
    token,
  });
}

export function getPlaceSettings(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<PlaceSettings> {
  return request<PlaceSettings>(placesPath(workspaceId, "/settings"), { token, signal });
}

export function updatePlaceSettings(
  token: string,
  workspaceId: string,
  onlineMaps: boolean,
): Promise<PlaceSettings> {
  return request<PlaceSettings>(placesPath(workspaceId, "/settings"), {
    method: "PUT",
    body: { online_maps: onlineMaps },
    token,
  });
}
