import { cx } from "../../utils/cx";

export interface LoadingStateProps {
  /** Number of skeleton rows/lines to render. */
  lines?: number;
  className?: string;
  label?: string;
}

/** PC-08 universal state — skeletons on `--bg-warm`, never a bare spinner
 * for content areas (PC-08 §3). */
export function LoadingState({ lines = 3, className, label = "Loading" }: LoadingStateProps) {
  return (
    <div className={cx("ps-loading-state", className)} role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="ps-loading-state__line" style={{ inlineSize: i === lines - 1 ? "60%" : "100%" }} />
      ))}
    </div>
  );
}
