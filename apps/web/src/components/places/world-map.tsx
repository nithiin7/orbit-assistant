"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Place, PlaceStatus } from "@orbit/contracts";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  StyleSpecification,
} from "maplibre-gl";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { CODE_BY_NUMERIC, countryStatuses } from "@/lib/places";
import { cn } from "@/utils/common";

type WorldMapProps = {
  places: readonly Place[];
  /** The online map style; `null` keeps the map offline (bundled country shapes only). */
  styleUrl: string | null;
  /** What the map shows, for screen readers; the lists beside it carry the detail. */
  label: string;
  onSelectPlace?: (placeId: string) => void;
  className?: string;
};

type Palette = { land: string; water: string; border: string; visited: string; wished: string };

const COUNTRIES_SOURCE = "orbit-countries";
const PLACES_SOURCE = "orbit-places";

/** A CSS color (tokens are `oklch`, which MapLibre can't read) as `rgba()`, via one pixel. */
function toRgba(context: CanvasRenderingContext2D, color: string, fallback: string): string {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = fallback;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

function readPalette(element: HTMLElement): Palette {
  const styles = getComputedStyle(element);
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const token = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim() || fallback;
    return context ? toRgba(context, value, fallback) : fallback;
  };
  return {
    land: token("--muted", "#ececec"),
    water: token("--background", "#fafafa"),
    border: token("--border", "#d4d4d4"),
    visited: token("--brand", "#c2410c"),
    wished: token("--brand-2", "#0f766e"),
  };
}

/** The bundled world map (Natural Earth, 1:50m), as GeoJSON with each shape's ISO code. */
async function loadCountries(): Promise<FeatureCollection> {
  const [{ feature }, atlas] = await Promise.all([
    import("topojson-client"),
    import("world-atlas/countries-50m.json"),
  ]);
  const topology = atlas.default as unknown as Parameters<typeof feature>[0];
  const countries = feature(
    topology,
    topology.objects.countries as Parameters<typeof feature>[1],
  ) as FeatureCollection<Geometry, { name?: string }>;
  return {
    type: "FeatureCollection",
    features: countries.features
      .map((shape) => ({
        ...shape,
        properties: { code: CODE_BY_NUMERIC.get(String(shape.id)) ?? "" },
      }))
      // Antarctica fills the bottom of a flat map and nobody's tally hangs on it.
      .filter((shape) => shape.properties.code !== "AQ"),
  };
}

function withStatuses(countries: FeatureCollection, places: readonly Place[]): FeatureCollection {
  const statuses = countryStatuses(places);
  return {
    ...countries,
    features: countries.features.map((shape) => {
      const code = String(shape.properties?.code ?? "");
      return { ...shape, properties: { code, status: statuses.get(code) ?? "none" } };
    }),
  };
}

function pins(
  places: readonly Place[],
): FeatureCollection<Point, { id: string; status: PlaceStatus }> {
  return {
    type: "FeatureCollection",
    features: places.flatMap((place): Feature<Point, { id: string; status: PlaceStatus }>[] =>
      place.location
        ? [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [place.location.longitude, place.location.latitude],
              },
              properties: { id: place.id, status: place.status },
            },
          ]
        : [],
    ),
  };
}

/** The offline map: just a background; the country shapes are added once it loads. */
function offlineStyle(palette: Palette): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      { id: "background", type: "background", paint: { "background-color": palette.water } },
    ],
  };
}

function addLayers(map: MapLibreMap, palette: Palette, online: boolean) {
  map.addLayer({
    id: "orbit-countries-fill",
    type: "fill",
    source: COUNTRIES_SOURCE,
    paint: {
      "fill-color": [
        "match",
        ["get", "status"],
        "visited",
        palette.visited,
        "want_to_visit",
        palette.wished,
        palette.land,
      ],
      // Online, only tint the countries so the map's own detail shows through.
      "fill-opacity": online
        ? ["match", ["get", "status"], "visited", 0.35, "want_to_visit", 0.2, 0]
        : ["match", ["get", "status"], "visited", 0.9, "want_to_visit", 0.45, 1],
    },
  });
  if (!online) {
    map.addLayer({
      id: "orbit-countries-line",
      type: "line",
      source: COUNTRIES_SOURCE,
      paint: { "line-color": palette.water, "line-width": 0.6 },
    });
  }
  map.addLayer({
    id: "orbit-clusters",
    type: "circle",
    source: PLACES_SOURCE,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": palette.visited,
      "circle-radius": ["step", ["get", "point_count"], 9, 5, 12, 20, 16],
      "circle-stroke-width": 2,
      "circle-stroke-color": palette.water,
    },
  });
  map.addLayer({
    id: "orbit-pins",
    type: "circle",
    source: PLACES_SOURCE,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": ["match", ["get", "status"], "visited", palette.visited, palette.wished],
      "circle-radius": 5.5,
      "circle-stroke-width": 2,
      "circle-stroke-color": palette.water,
    },
  });
}

function applyPalette(map: MapLibreMap, palette: Palette, online: boolean) {
  if (!online) map.setPaintProperty("background", "background-color", palette.water);
  map.setPaintProperty("orbit-countries-fill", "fill-color", [
    "match",
    ["get", "status"],
    "visited",
    palette.visited,
    "want_to_visit",
    palette.wished,
    palette.land,
  ]);
  if (!online) map.setPaintProperty("orbit-countries-line", "line-color", palette.water);
  map.setPaintProperty("orbit-clusters", "circle-color", palette.visited);
  map.setPaintProperty("orbit-clusters", "circle-stroke-color", palette.water);
  map.setPaintProperty("orbit-pins", "circle-color", [
    "match",
    ["get", "status"],
    "visited",
    palette.visited,
    palette.wished,
  ]);
  map.setPaintProperty("orbit-pins", "circle-stroke-color", palette.water);
}

/**
 * Your world on a map: visited countries shaded, wished-for ones lighter, and a pin for each place
 * with a position. Offline it draws only the bundled country shapes; with online maps it loads
 * tiles from `styleUrl`. MapLibre loads on demand, so pages without a map don't pay for it.
 */
export function WorldMap({ places, styleUrl, label, onSelectPlace, className }: WorldMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const countriesRef = useRef<FeatureCollection | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const online = styleUrl !== null;

  const currentPlaces = useEffectEvent(() => places);
  const selectPlace = useEffectEvent((id: string) => onSelectPlace?.(id));

  // Build the map once per style; places update the sources below.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let cancelled = false;
    let observer: MutationObserver | null = null;

    void (async () => {
      try {
        const [maplibre, countries] = await Promise.all([
          import("maplibre-gl"),
          countriesRef.current ? Promise.resolve(countriesRef.current) : loadCountries(),
        ]);
        if (cancelled) return;
        // MapLibre 6 runs its tile worker from a separate module file, which it would look for
        // next to its own (bundled) code; point it at the copy the bundler emits instead.
        maplibre.setWorkerUrl(
          new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href,
        );
        countriesRef.current = countries;
        const palette = readPalette(element);
        const map = new maplibre.Map({
          container: element,
          style: styleUrl ?? offlineStyle(palette),
          center: [12, 28],
          zoom: 0.6,
          minZoom: 0.3,
          maxZoom: online ? 16 : 6,
          renderWorldCopies: false,
          attributionControl: online ? { compact: true } : false,
          dragRotate: false,
          pitchWithRotate: false,
          cooperativeGestures: true,
        });
        mapRef.current = map;
        map.touchZoomRotate.disableRotation();
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        map.once("load", () => {
          if (cancelled) return;
          map.fitBounds(
            [
              [-170, -50],
              [180, 75],
            ],
            { padding: 8, animate: false },
          );
          const latest = currentPlaces();
          map.addSource(COUNTRIES_SOURCE, {
            type: "geojson",
            data: withStatuses(countries, latest),
          });
          map.addSource(PLACES_SOURCE, {
            type: "geojson",
            data: pins(latest),
            cluster: true,
            clusterRadius: 32,
            clusterMaxZoom: 9,
          });
          addLayers(map, palette, online);
          map.on("click", "orbit-pins", (event: MapLayerMouseEvent) => {
            const id = event.features?.[0]?.properties?.id;
            if (typeof id === "string") selectPlace(id);
          });
          map.on("click", "orbit-clusters", (event: MapLayerMouseEvent) => {
            map.easeTo({ center: event.lngLat, zoom: map.getZoom() + 2 });
          });
          for (const layer of ["orbit-pins", "orbit-clusters"]) {
            map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
            map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
          }
          setStatus("ready");
        });
        map.on("error", () => {
          if (!map.loaded()) setStatus("error");
        });
        // Follow light and dark mode and palette changes.
        observer = new MutationObserver(() => {
          if (map.getLayer("orbit-pins")) applyPalette(map, readPalette(element), online);
        });
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "data-palette", "style"],
        });
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [styleUrl, online]);

  // Keep the shading and pins in step with the places.
  useEffect(() => {
    const map = mapRef.current;
    const countries = countriesRef.current;
    if (status !== "ready" || !map || !countries) return;
    map.getSource<GeoJSONSource>(COUNTRIES_SOURCE)?.setData(withStatuses(countries, places));
    map.getSource<GeoJSONSource>(PLACES_SOURCE)?.setData(pins(places));
  }, [places, status]);

  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative overflow-hidden rounded-2xl border bg-background", className)}
    >
      {/* MapLibre's own (unlayered) CSS sets `position: relative` on the map's container, which
          beats Tailwind's layered `absolute`; so a wrapper takes the frame's size and the map
          fills it. */}
      <div className="absolute inset-0">
        <div ref={container} className="size-full" />
      </div>
      {status === "loading" ? (
        <div className="absolute inset-0 animate-pulse bg-muted/60" aria-hidden="true" />
      ) : null}
      {status === "error" ? (
        <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
          {online
            ? "The online map didn’t load. Your places are listed below."
            : "The map couldn’t be drawn in this browser. Your places are listed below."}
        </p>
      ) : null}
    </div>
  );
}
