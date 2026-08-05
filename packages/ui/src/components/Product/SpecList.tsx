import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface SpecRow {
  label: string;
  value: ReactNode;
  /** Latin technical values — `5W-30`, `API SN`, `DOT 4`, `5,000 km`. Bidi
   * isolation is not optional on these: unisolated, `API SN` inside Arabic
   * copy reorders to `SN API`. */
  ltr?: boolean;
}

export interface SpecListProps {
  /** Names the list for assistive tech — a datasheet carries more than one. */
  label: string;
  rows: SpecRow[];
  className?: string;
}

/** The quick-spec table on a product datasheet.
 *
 * A description list rather than a `<table>`, because that is what it is: ten
 * named facts about one product, not a grid to compare rows across. It also
 * means it reflows to one column on a phone without a mobile-table strategy,
 * and a screen reader reads "Grade, 5W-30" instead of navigating a table with
 * one data row in it.
 *
 * Replaces the raw `<table>` the datasheet carried, whose header cells set
 * `textAlign: locale === "ar" ? "right" : "left"` in five places — five
 * inline styles doing what `text-align: start` does for free. */
export function SpecList({ label, rows, className }: SpecListProps) {
  return (
    <dl className={cx("ps-specs", className)} aria-label={label}>
      {rows.map((row) => (
        <div className="ps-specs__row" key={row.label}>
          <dt className="ps-specs__label">{row.label}</dt>
          <dd className={cx("ps-specs__value", row.ltr && "ps-ltr")}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
