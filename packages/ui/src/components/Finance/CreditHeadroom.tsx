import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import { Progress } from "../Feedback/Progress";

export interface CreditHeadroomProps {
  /** All three figures come from the server already formatted — the UI never
   * computes a price, a VAT amount or an exposure (NFR-SP-005). The ratio
   * below is for drawing a bar, not for stating a number. */
  limit: ReactNode;
  exposure: ReactNode;
  headroom: ReactNode;
  labels: {
    limit: string;
    exposure: string;
    headroom: string;
    /** Accessible name for the bar, e.g. "استخدام حد الائتمان". */
    usage: string;
  };
  /** Server-computed fraction used 0..1, purely to size the bar. */
  usedRatio: number;
  /** Set when the API answered CREDIT_LIMIT_EXCEEDED. Carries the localized
   * message and the shortfall, both from the server. */
  exceeded?: { message: ReactNode; shortfallLabel: string; shortfall: ReactNode };
  className?: string;
}

/** Limit, exposure and headroom for a B2B account.
 *
 * Belongs inside the debt FinancePanel and nowhere else: headroom is a fact
 * about credit, and putting it next to a custody figure would imply the two
 * net off. When the limit is exceeded the block is stated in words with the
 * exact shortfall, because "you cannot place this order" without a number is
 * an instruction to phone someone. */
export function CreditHeadroom({
  limit,
  exposure,
  headroom,
  labels,
  usedRatio,
  exceeded,
  className
}: CreditHeadroomProps) {
  const pct = Math.min(Math.max(usedRatio, 0), 1) * 100;
  return (
    <div className={cx("ps-headroom", className)}>
      <dl className="ps-headroom__figures">
        <div className="ps-headroom__figure">
          <dt>{labels.limit}</dt>
          <dd>{limit}</dd>
        </div>
        <div className="ps-headroom__figure">
          <dt>{labels.exposure}</dt>
          <dd>{exposure}</dd>
        </div>
        <div className={cx("ps-headroom__figure", "ps-headroom__figure--headroom")}>
          <dt>{labels.headroom}</dt>
          <dd>{headroom}</dd>
        </div>
      </dl>
      <Progress
        value={pct}
        max={100}
        label={labels.usage}
        tone={exceeded ? "info" : pct > 80 ? "info" : "success"}
        className="ps-headroom__bar"
      />
      {exceeded ? (
        <div className="ps-headroom__block" role="alert">
          <Icon name="alert" size="lg" />
          <div>
            <p className="ps-headroom__block-message">{exceeded.message}</p>
            <p className="ps-headroom__block-shortfall">
              {exceeded.shortfallLabel} {exceeded.shortfall}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
