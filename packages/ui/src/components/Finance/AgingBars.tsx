import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface AgingBucket {
  /** `0-30`, `31-60`, `61-90`, `90+` — localized by the caller. */
  label: string;
  /** Already formatted money. */
  amount: ReactNode;
  /** Server-computed share of the total, 0..1, for the bar length only. */
  share: number;
}

export interface AgingBarsProps {
  /** Names the chart, e.g. "أعمار الذمم". */
  label: string;
  buckets: AgingBucket[];
  className?: string;
}

/** Receivables aging, drawn as bars but readable as a table.
 *
 * Deliberately not a chart library: four labelled bars with their amounts
 * beside them are the whole content, and a canvas would put those amounts
 * out of reach of a screen reader, a text search and a printed statement.
 * The bars are decoration on top of a description list.
 *
 * The bar length is a `packages/ui` inline style, which is exactly the escape
 * hatch §5.3 describes — app code passes a number, the primitive turns it
 * into a width. Older buckets darken, so severity is not carried by hue
 * alone. */
export function AgingBars({ label, buckets, className }: AgingBarsProps) {
  return (
    <dl className={cx("ps-aging", className)} aria-label={label}>
      {buckets.map((bucket, index) => (
        <div key={bucket.label} className="ps-aging__row">
          <dt className="ps-aging__label">{bucket.label}</dt>
          <dd className="ps-aging__value">
            <span className="ps-aging__amount">{bucket.amount}</span>
            <span className="ps-aging__track" aria-hidden="true">
              <span
                className={cx("ps-aging__bar", `ps-aging__bar--${index}`)}
                style={{ inlineSize: `${Math.min(Math.max(bucket.share, 0), 1) * 100}%` }}
              />
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
