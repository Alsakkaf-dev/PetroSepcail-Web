import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import type { MapPointKind } from "./MapMarker";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  /** The place in words — a business name, a district, "your driver".
   * Already localised. */
  label: string;
  /** A second line: an ETA, a distance, a status. Already formatted. */
  detail?: ReactNode;
  kind?: MapPointKind;
  /** Position in the route. Drawn on the pin and read out in the list. */
  order?: number;
  /** The one point that is moving. */
  live?: boolean;
}

export interface MapFallbackListProps {
  /** Names the list. A screen with two maps needs two names. */
  label: string;
  points: MapPoint[];
  /** Shown in place of the list when there is nothing to plot. */
  emptyLabel: string;
  className?: string;
}

const KIND_ICON = {
  driver: "truck",
  b2b_drop: "building",
  b2c_home: "map-pin",
  b2c_pickup: "package",
  hub: "droplet",
  place: "map-pin"
} as const;

/**
 * The same places as the map, in words.
 *
 * Not a degraded mode and not a `<noscript>` — it renders every time, under
 * the picture, and it is the only accessible representation of the map's
 * content. A tile image cannot be read out, cannot be searched, cannot be
 * printed usefully and is worthless on a 2G connection in a van; the list is
 * all four. It is also what the screen falls back to on its own when no tile
 * host is configured.
 */
export function MapFallbackList({ label, points, emptyLabel, className }: MapFallbackListProps) {
  if (points.length === 0) {
    return (
      <p className={cx("ps-map__empty", className)}>{emptyLabel}</p>
    );
  }
  return (
    <ol className={cx("ps-map__list", className)} aria-label={label}>
      {points.map((point) => (
        <li key={point.id} className={cx("ps-map__item", `ps-map__item--${point.kind ?? "place"}`)}>
          <span className="ps-map__item-mark" aria-hidden="true">
            {point.order === undefined ? (
              <Icon name={KIND_ICON[point.kind ?? "place"]} size="sm" />
            ) : (
              <span className="ps-map__order">{point.order}</span>
            )}
          </span>
          <span className="ps-map__item-text">
            <span className="ps-map__item-label">{point.label}</span>
            {point.detail === undefined ? null : <span className="ps-map__item-detail">{point.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
