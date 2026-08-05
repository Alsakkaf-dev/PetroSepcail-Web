import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

export type SummaryRowEmphasis = "normal" | "muted" | "credit" | "total";

export interface SummaryRow {
  id: string;
  label: ReactNode;
  /** Already formatted and already decided by the server. This component does
   * no arithmetic — NFR-SP-005: the UI never computes money. */
  value: ReactNode;
  /** `credit` for a line that reduces the total (a discount, redeemed points),
   * `total` for the figure the screen is about, `muted` for an itemisation. */
  emphasis?: SummaryRowEmphasis;
}

export interface SummaryPanelProps {
  /** Names the figures — "order summary", "statement closing balance". */
  label: string;
  rows: SummaryRow[];
  /** A progress bar, a note, the checkout button. */
  children?: ReactNode;
  className?: string;
}

/**
 * The money side of a cart, a checkout review or an invoice: subtotal, VAT,
 * discount, delivery, total.
 *
 * It is a description list because that is what it is — each figure is the
 * value of a named thing, and a screen reader should pair them. Rendering it
 * as rows of `<span>`s reads back as an unattached run of numbers, which is
 * exactly how much of this platform used to render its totals.
 *
 * Retail figures arrive VAT-inclusive with VAT itemised as its own row;
 * wholesale arrives ex-VAT with VAT itemised per ZATCA. Both are just rows
 * here — the caller decides, because only the caller knows which session it is
 * in.
 */
export function SummaryPanel({ label, rows, children, className }: SummaryPanelProps) {
  return (
    // The name goes on a labelled group rather than on the <dl>: a
    // description list carries no implicit role, so an aria-label on it is
    // announced by some readers and dropped by others. The group is.
    <div className={cx("ps-summary", className)} role="group" aria-label={label}>
      <dl className="ps-summary__rows">
        {rows.map((row) => (
          <div key={row.id} className={cx("ps-summary__row", `ps-summary__row--${row.emphasis ?? "normal"}`)}>
            <dt className="ps-summary__label">{row.label}</dt>
            <dd className="ps-summary__value">{row.value}</dd>
          </div>
        ))}
      </dl>
      {children ? <div className="ps-summary__foot">{children}</div> : null}
    </div>
  );
}
