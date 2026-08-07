import type { CSSProperties, ReactNode } from "react";
import { cx } from "../../utils/cx";
import { MapMarker } from "./MapMarker";
import { MapFallbackList, type MapPoint } from "./MapFallbackList";
import { centerOf, fitZoom, positionOf, tileHref, tilesFor, tileTemplate, viewFor, type LatLng } from "./geo";

export interface MapProps {
  /** Names the whole map region. */
  label: string;
  points: MapPoint[];
  /** Force the centre. Defaults to the middle of the points' bounding box. */
  center?: LatLng;
  /** Force the zoom. Defaults to the closest zoom that still fits every
   * point, or 13 when there is only one. */
  zoom?: number;
  /** `{z}/{x}/{y}` raster template. Defaults to `NEXT_PUBLIC_MAP_TILE_URL`;
   * when neither is set the picture is skipped and `unavailableLabel` says so. */
  tileUrl?: string | null;
  /** The tile licence's attribution line. Required by every OSM tile host,
   * and the reason this is not optional. */
  attribution: ReactNode;
  /** Heading for the textual list, which always renders. */
  fallbackLabel: string;
  /** Shown in the list's place when there is nothing to plot. */
  emptyLabel: string;
  /** Why there is no picture. Shown whenever no tile host is configured — the
   * honest version of a blank grey rectangle. */
  unavailableLabel: string;
  className?: string;
}

/**
 * A map: a raster tile mosaic with pins on it, and the same places written
 * out underneath.
 *
 * No map library, no WebGL, no vendor account — a fixed 4×3 grid of `<img>`
 * tiles from a template that arrives as a prop or an env var, with pins placed
 * by the same Web-Mercator arithmetic the tiles are cut on (`geo.ts`).
 * DEFERRED-DECISIONS §4 item 23 records the call and its reasons.
 *
 * Two rules it carries everywhere:
 *
 * 1. **The textual list always renders.** It is not a fallback for a failed
 *    image, it is the accessible representation of the content, and it is what
 *    a driver reads when the tiles have not cached.
 * 2. **The picture never mirrors.** Geography has no reading direction, so the
 *    mosaic and its pins are positioned physically while everything around
 *    them stays logical. That is deliberate and it is the only place in the
 *    library where it happens.
 */
export function Map({
  label,
  points,
  center,
  zoom,
  tileUrl,
  attribution,
  fallbackLabel,
  emptyLabel,
  unavailableLabel,
  className
}: MapProps) {
  const template = tileTemplate(tileUrl);
  const resolvedCenter = center ?? centerOf(points);
  const view = resolvedCenter ? viewFor(resolvedCenter, zoom ?? fitZoom(points)) : null;
  const canDraw = template !== null && view !== null;

  return (
    <section className={cx("ps-map", className)} aria-label={label}>
      {canDraw ? (
        <div className="ps-map__canvas" aria-hidden="true">
          <div className="ps-map__layer">
            {tilesFor(view).map((tile) => {
              const style: CSSProperties = { left: `${tile.leftPct}%`, top: `${tile.topPct}%` };
              return (
                <img
                  key={`${tile.z}-${tile.x}-${tile.y}`}
                  className="ps-map__tile"
                  src={tileHref(template, tile)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={style}
                />
              );
            })}
            {points.map((point) => {
              const at = positionOf(point, view);
              if (!at.inView) return null;
              return (
                <MapMarker
                  key={point.id}
                  leftPct={at.leftPct}
                  topPct={at.topPct}
                  kind={point.kind}
                  order={point.order}
                  live={point.live}
                />
              );
            })}
          </div>
        </div>
      ) : (
        <p className="ps-map__unavailable">{unavailableLabel}</p>
      )}

      <MapFallbackList label={fallbackLabel} points={points} emptyLabel={emptyLabel} />

      <p className="ps-map__attribution">{attribution}</p>
    </section>
  );
}
