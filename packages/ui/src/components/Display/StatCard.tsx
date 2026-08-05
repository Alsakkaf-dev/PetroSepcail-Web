import type { ElementType, ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon, type IconName } from "../../icons";

export interface StatCardProps {
  label: string;
  /** Already formatted and localized — a <Money>, a <Ltr>, a count. */
  value: ReactNode;
  /** One line under the value: what it covers, or why it is what it is. */
  caption?: ReactNode;
  icon?: IconName;
  tone?: "neutral" | "gold" | "blue" | "success" | "warn" | "danger";
  /** Wraps the whole tile in a link. */
  href?: string;
  /** `next/link` in an app; a plain anchor everywhere else. */
  linkAs?: ElementType;
  className?: string;
}

/** A single figure with its name — an account tile, a shift summary, a
 * dashboard KPI.
 *
 * The label is rendered before the value in the DOM, which is what a screen
 * reader reads first; the visual order puts the number first because that is
 * what the eye is looking for. That is a deliberate divergence and the only
 * one here — CSS reorders two elements inside one small tile, where either
 * sequence is a complete sentence. */
export function StatCard({ label, value, caption, icon, tone = "neutral", href, linkAs, className }: StatCardProps) {
  const Link: ElementType = linkAs ?? "a";
  const body = (
    <>
      <span className="ps-stat__label">{label}</span>
      <span className="ps-stat__value">{value}</span>
      {caption ? <span className="ps-stat__caption">{caption}</span> : null}
      {icon ? (
        <span className="ps-stat__icon" aria-hidden="true">
          <Icon name={icon} size="lg" />
        </span>
      ) : null}
    </>
  );
  const classes = cx("ps-stat", `ps-stat--${tone}`, href && "ps-stat--link", className);
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

export interface KpiTileProps extends StatCardProps {
  /** When the figure was computed, already formatted. Every analytics panel
   * shows its own as-of time — a dashboard without one is a dashboard whose
   * numbers cannot be checked. */
  asOf?: ReactNode;
  /** How the figure is derived, shown on hover and to assistive tech. */
  formula?: string;
  /** Direction of travel against the previous period. Never the only signal:
   * the label says which way is good, since fewer failed deliveries is up. */
  trend?: { direction: "up" | "down" | "flat"; label: string };
  /** k≥5 privacy suppression. When set, the value is replaced by an em dash
   * and this explanation — the real figure is never rendered and then
   * hidden, because hidden is not the same as absent. */
  suppressedLabel?: string;
}

const TREND_ICON: Record<"up" | "down" | "flat", IconName> = {
  up: "chevron-up",
  down: "chevron-down",
  flat: "minus"
};

/** A dashboard KPI: a StatCard that also has to say when it was computed,
 * how it was derived, and when it is not allowed to tell you. */
export function KpiTile({
  label,
  value,
  caption,
  icon,
  tone = "neutral",
  asOf,
  formula,
  trend,
  suppressedLabel,
  className
}: KpiTileProps) {
  const suppressed = Boolean(suppressedLabel);
  return (
    <div className={cx("ps-stat", "ps-kpi", `ps-stat--${tone}`, className)} title={formula}>
      <span className="ps-stat__label">
        {label}
        {formula ? <span className="ps-visually-hidden">{formula}</span> : null}
      </span>
      <span className={cx("ps-stat__value", suppressed && "ps-kpi__value--suppressed")}>
        {suppressed ? "—" : value}
      </span>
      {suppressed ? (
        <span className="ps-kpi__suppressed">{suppressedLabel}</span>
      ) : (
        <>
          {trend ? (
            <span className={cx("ps-kpi__trend", `ps-kpi__trend--${trend.direction}`)}>
              <Icon name={TREND_ICON[trend.direction]} size="sm" />
              {trend.label}
            </span>
          ) : null}
          {caption ? <span className="ps-stat__caption">{caption}</span> : null}
        </>
      )}
      {asOf ? <span className="ps-kpi__as-of">{asOf}</span> : null}
      {icon ? (
        <span className="ps-stat__icon" aria-hidden="true">
          <Icon name={icon} size="lg" />
        </span>
      ) : null}
    </div>
  );
}
