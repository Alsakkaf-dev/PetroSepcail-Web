import { cx } from "../../utils/cx";
import { Skeleton } from "../Skeleton/Skeleton";

export interface LoadingStateProps {
  /** Number of skeleton lines to render. Match the real content's shape — a
   * three-line card gets three, a list gets one per visible row. */
  lines?: number;
  className?: string;
  /** Announced once while loading. Pass the localized string. */
  label?: string;
}

/** PC-08 universal state — skeletons on `--bg-warm`, never a bare spinner
 * for content areas (PC-08 §3).
 *
 * The live region lives here and the bars are `aria-hidden`, so a screen
 * reader hears "loading" once rather than once per bar. The last line is
 * short, which is what makes a block of bars read as a paragraph of text
 * rather than as a table. */
export function LoadingState({ lines = 3, className, label = "Loading" }: LoadingStateProps) {
  return (
    <div className={cx("ps-loading-state", className)} role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 && lines > 1 ? "1/2" : "full"} />
      ))}
    </div>
  );
}
