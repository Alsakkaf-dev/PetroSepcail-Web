import type { CSSProperties, ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface BarProps {
  /** 0..1, already worked out by the caller from server figures. This is a
   * length, not a number anyone reads. */
  share: number;
  tone?: "gold" | "blue" | "success" | "warn" | "danger" | "muted";
  className?: string;
}

/** One bar. The `packages/ui` inline-style exemption §5.3 describes exists
 * for exactly this: app code passes a fraction, the primitive turns it into a
 * width, and `apps/` stays at zero inline styles. */
export function Bar({ share, tone = "gold", className }: BarProps) {
  const clamped = Math.min(Math.max(share, 0), 1);
  const style: CSSProperties = { inlineSize: `${clamped * 100}%` };
  return (
    <span className={cx("ps-bar", className)} aria-hidden="true">
      <span className={cx("ps-bar__fill", `ps-bar__fill--${tone}`)} style={style} />
    </span>
  );
}

export interface TrendPoint {
  /** The x label — a day, a month, a bucket. Already localised. */
  label: string;
  /** The y value as a fraction of the series maximum, 0..1. */
  share: number;
  /** The figure itself, already formatted — a `<Money>`, a count. */
  value: ReactNode;
}

export interface TrendChartProps {
  /** Names the chart. A dashboard with four of them needs four names. */
  label: string;
  points: TrendPoint[];
  tone?: BarProps["tone"];
  /** Column headings for the underlying table. */
  columns?: { label: string; value: string };
  className?: string;
}

/**
 * A trend over time, drawn as bars but readable as a table.
 *
 * Same decision `AgingBars` made and for the same reason: the numbers are the
 * content and the drawing is on top of them. A `<canvas>` would put every
 * figure out of reach of a screen reader, a browser's find-in-page, a
 * copy-paste into a spreadsheet and a printed page — which is most of what an
 * operations dashboard is actually used for.
 *
 * Deliberately not a line chart. Bars survive being one column wide on a
 * phone; a polyline does not, and this has to work at 360px.
 */
export function TrendChart({ label, points, tone = "gold", columns, className }: TrendChartProps) {
  return (
    <table className={cx("ps-trend", className)}>
      <caption className="ps-trend__caption">{label}</caption>
      <thead className="ps-visually-hidden">
        <tr>
          <th scope="col">{columns?.label ?? label}</th>
          <th scope="col">{columns?.value ?? label}</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.label} className="ps-trend__row">
            <th scope="row" className="ps-trend__label">
              {point.label}
            </th>
            <td className="ps-trend__cell">
              <Bar share={point.share} tone={tone} />
              <span className="ps-trend__value">{point.value}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface SparklineProps {
  /** Names the shape for assistive tech; the figure beside it carries the
   * actual value. */
  label: string;
  /** Each point as a fraction of the series maximum, 0..1. */
  points: number[];
  tone?: BarProps["tone"];
  className?: string;
}

/**
 * A shape, not a chart: the direction of travel beside a KPI tile.
 *
 * `aria-hidden`, because a sparkline with no axes and no labels says nothing
 * a screen reader can use — the tile's own figure and its as-of timestamp are
 * what carry the meaning, and repeating "graphic" beside them is noise. It
 * still gets a `label` for the title attribute, so a sighted user hovering it
 * learns what it is measuring.
 */
export function Sparkline({ label, points, tone = "gold", className }: SparklineProps) {
  const max = points.length > 0 ? Math.max(...points, 0) : 0;
  return (
    <span className={cx("ps-sparkline", className)} title={label} aria-hidden="true">
      {points.map((point, index) => {
        const share = max > 0 ? point / max : 0;
        const style: CSSProperties = { blockSize: `${Math.max(share * 100, 4)}%` };
        return (
          <span
            key={index}
            className={cx("ps-sparkline__bar", `ps-sparkline__bar--${tone}`)}
            style={style}
          />
        );
      })}
    </span>
  );
}
