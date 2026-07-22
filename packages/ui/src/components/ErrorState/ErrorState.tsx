import { Button } from "../Button/Button";
import { cx } from "../../utils/cx";
import "./ErrorState.css";

export interface ErrorStateProps {
  /** Localized message resolved from the PC-04 §8 error registry — never a
   * raw error/stack string. */
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
}

/** PC-08 universal state — `--flame` inline message from the error registry
 * + retry (PC-08 §3). Text stays `--ink`; `--flame` is the accent border/dot
 * only, since it alone fails AA for normal-size text (a11y/contrast.test.ts). */
export function ErrorState({ message, retryLabel = "Retry", onRetry, className }: ErrorStateProps) {
  return (
    <div className={cx("ps-error-state", className)} role="alert">
      <span className="ps-error-state__dot" aria-hidden="true" />
      <p className="ps-error-state__message">{message}</p>
      {onRetry ? (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
