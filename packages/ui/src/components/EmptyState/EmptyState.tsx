import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface EmptyStateProps {
  /** Illustration slot — an <svg> or <img>; kept generic so each consuming
   * system supplies its own, per PC-08 §3 ("empty — illustration + ..."). */
  illustration?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** PC-08 universal state — one of the four every data-bearing component
 * must specify (PC-08 §3). */
export function EmptyState({ illustration, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cx("ps-empty-state", className)} role="status">
      {illustration ? <div className="ps-empty-state__illustration">{illustration}</div> : null}
      <p className="ps-empty-state__title">{title}</p>
      {description ? <p className="ps-empty-state__description">{description}</p> : null}
      {action ? <div className="ps-empty-state__action">{action}</div> : null}
    </div>
  );
}
