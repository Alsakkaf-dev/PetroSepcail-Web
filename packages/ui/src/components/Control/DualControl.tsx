import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";

export type DualControlState = "below-threshold" | "pending" | "approved" | "rejected";

export interface DualControlProps {
  state: DualControlState;
  /** "Changes above SAR 100,000 need a second super-admin." Always shown,
   * including below the threshold — someone about to type a larger number
   * should learn the rule before they hit it, not after. */
  thresholdNote: ReactNode;
  /** What is waiting: who requested it, what it would change, when. */
  summary?: ReactNode;
  /** "Waiting for a different super-admin to approve." */
  pendingLabel: string;
  approvedLabel: string;
  rejectedLabel: string;
  /** Approve/reject controls. The caller decides whether the viewer is
   * allowed to see them — the API is the one that enforces it. */
  actions?: ReactNode;
  className?: string;
}

/**
 * A change that one person is not allowed to make alone.
 *
 * A credit-limit change above SAR 100,000 returns `pending_dual_control`
 * instead of applying (`EP-AC-021`), and acknowledging it requires a
 * genuinely *different* super-admin. The old console reported that state as
 * the bare string "pending a second admin's ack" in a table cell, which read
 * as an error rather than as the system working correctly.
 *
 * What this makes visible: that the request landed, that it is waiting on a
 * second person, and that the second person is not the one who asked. The
 * enforcement itself is server-side and always was — this is the screen
 * telling the truth about it.
 */
export function DualControl({
  state,
  thresholdNote,
  summary,
  pendingLabel,
  approvedLabel,
  rejectedLabel,
  actions,
  className
}: DualControlProps) {
  const label =
    state === "pending" ? pendingLabel : state === "approved" ? approvedLabel : state === "rejected" ? rejectedLabel : null;

  return (
    <section className={cx("ps-dual", `ps-dual--${state}`, className)} aria-live="polite">
      <p className="ps-dual__threshold">
        <Icon name="shield" size="sm" />
        <span>{thresholdNote}</span>
      </p>

      {label ? (
        <p className="ps-dual__state">
          <Icon
            name={state === "approved" ? "check-circle" : state === "rejected" ? "x-circle" : "clock"}
            size="sm"
          />
          <span>{label}</span>
        </p>
      ) : null}

      {summary ? <div className="ps-dual__summary">{summary}</div> : null}
      {actions ? <div className="ps-dual__actions">{actions}</div> : null}
    </section>
  );
}
