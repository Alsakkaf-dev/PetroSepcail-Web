import type { CSSProperties } from "react";
import { cx } from "../../utils/cx";
import { Icon, type IconName } from "../../icons";

/** What a pin stands for. The three delivery kinds match `StopCard`'s own
 * vocabulary so a stop is the same colour on the manifest and on the map;
 * `driver` is the moving one, `hub` the depot, `place` anything else. */
export type MapPointKind = "driver" | "b2b_drop" | "b2c_home" | "b2c_pickup" | "hub" | "place";

const KIND_ICON: Record<MapPointKind, IconName> = {
  driver: "truck",
  b2b_drop: "building",
  b2c_home: "map-pin",
  b2c_pickup: "package",
  // The depot is ours, so it gets the brand droplet rather than a second
  // building that would read as another distributor.
  hub: "droplet",
  place: "map-pin"
};

export interface MapMarkerProps {
  /** Position inside the mosaic, as a percentage. Worked out by `Map` from
   * the projection — §5.3's dynamic-value primitive, which is why `apps/`
   * never needs an inline style to place a pin. */
  leftPct: number;
  topPct: number;
  kind?: MapPointKind;
  /** Position in the route, drawn on the pin. */
  order?: number;
  /** The moving marker gets a soft halo. It stops under reduced motion. */
  live?: boolean;
  className?: string;
}

/**
 * One pin.
 *
 * Decorative by construction: every pin's meaning is carried in the textual
 * list `Map` always renders beneath the picture, so the pin itself is
 * `aria-hidden` and there is nothing here for a screen reader to lose. A pin
 * never mirrors — geography has no reading direction — which is why this is
 * the one component in the library positioned with `left`/`top` rather than
 * logical properties, and Map.css says so where it happens.
 */
export function MapMarker({ leftPct, topPct, kind = "place", order, live, className }: MapMarkerProps) {
  const style: CSSProperties = { left: `${leftPct}%`, top: `${topPct}%` };
  return (
    <span
      className={cx("ps-map__marker", `ps-map__marker--${kind}`, live && "ps-map__marker--live", className)}
      style={style}
      aria-hidden="true"
    >
      <span className="ps-map__pin">
        {order === undefined ? <Icon name={KIND_ICON[kind]} size="sm" /> : <span className="ps-map__order">{order}</span>}
      </span>
    </span>
  );
}
