import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon, type IconName } from "../../icons";

/** D-14's three delivery kinds. Each keeps its own accent and its own icon on
 * every screen a driver sees, so a wholesale drop and a customer's doorstep
 * never look like the same job. */
export type StopKind = "b2b_drop" | "b2c_home" | "b2c_pickup";

const KIND_ICON: Record<StopKind, IconName> = {
  b2b_drop: "building",
  b2c_home: "map-pin",
  b2c_pickup: "package"
};

export interface StopCardProps {
  kind: StopKind;
  /** The kind in words — "توريد للموزّعين", "توصيل منزلي". Colour never
   * carries this on its own. */
  kindLabel: string;
  /** Where it is going: a business name, a district, a pickup point. */
  destination: ReactNode;
  /** A `StatusBadge` on the delivery status. */
  status?: ReactNode;
  /** Position on the route, when the route order is being shown. */
  sequence?: ReactNode;
  /** A `DateTime`. */
  eta?: ReactNode;
  /** Item counts only. A driver's manifest carries no prices at all
   * (04-roles §3) — not the order total, not a unit price, nothing. */
  items?: ReactNode;
  /** The one primary action for this stop. */
  action?: ReactNode;
  className?: string;
}

/**
 * One stop on a driver's manifest.
 *
 * Built for a phone held in one hand: the whole card is a comfortable target,
 * the action sits at the bottom where a thumb reaches, and the kind is stated
 * in words beside a colour accent rather than by the colour alone.
 *
 * The rule it carries into every screen that uses it: **no prices.** A manifest
 * shows what to hand over and to whom, and a driver has no business seeing what
 * the customer paid.
 */
export function StopCard({
  kind,
  kindLabel,
  destination,
  status,
  sequence,
  eta,
  items,
  action,
  className
}: StopCardProps) {
  return (
    <li className={cx("ps-stop", `ps-stop--${kind}`, className)}>
      <div className="ps-stop__head">
        <span className="ps-stop__kind">
          <Icon name={KIND_ICON[kind]} size="sm" />
          {kindLabel}
        </span>
        {sequence ? <span className="ps-stop__sequence">{sequence}</span> : null}
        {status ? <span className="ps-stop__status">{status}</span> : null}
      </div>

      <p className="ps-stop__destination">{destination}</p>

      {eta || items ? (
        <dl className="ps-stop__facts">
          {eta ? (
            <div className="ps-stop__fact">
              <dt>
                <Icon name="clock" size="sm" />
              </dt>
              <dd>{eta}</dd>
            </div>
          ) : null}
          {items ? (
            <div className="ps-stop__fact">
              <dt>
                <Icon name="package" size="sm" />
              </dt>
              <dd>{items}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {action ? <div className="ps-stop__action">{action}</div> : null}
    </li>
  );
}

export interface StopSectionProps {
  /** The section heading — one of the three D-14 types, in words. */
  title: string;
  kind: StopKind;
  /** How many stops are in it, already formatted. */
  count?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * One of the manifest's three type-grouped sections.
 *
 * The grouping survives the route-order toggle: sorting by route changes the
 * order *inside* each section and never merges them, because a driver
 * reconciling at end of shift has to be able to say how many wholesale drops
 * they made without counting past the doorstep deliveries.
 */
export function StopSection({ title, kind, count, children, className }: StopSectionProps) {
  return (
    <section className={cx("ps-stop-section", `ps-stop-section--${kind}`, className)} aria-label={title}>
      <h2 className="ps-stop-section__title">
        <Icon name={KIND_ICON[kind]} size="sm" />
        <span>{title}</span>
        {count ? <span className="ps-stop-section__count">{count}</span> : null}
      </h2>
      <ul className="ps-stop-section__list">{children}</ul>
    </section>
  );
}
