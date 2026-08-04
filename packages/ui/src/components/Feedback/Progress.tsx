import type { CSSProperties } from "react";
import { cx } from "../../utils/cx";

export interface ProgressProps {
  value: number;
  max?: number;
  /** Accessible name — "التقدم نحو التوصيل المجاني", "نقاط الولاء". */
  label: string;
  /** Visible text beside the bar, already formatted and localized. */
  hint?: string;
  tone?: "gold" | "success" | "info";
  className?: string;
}

/** A determinate progress bar: free-delivery threshold, loyalty redemption
 * cap, an upload, a shift's stock reconciliation.
 *
 * This is one of the primitives §5.3 exists for. App code may not write an
 * inline style — the gate greps `apps/` for `style={{` and expects zero — so
 * the dynamic width is set here, inside `packages/ui`, from a numeric prop.
 * That exemption is the whole mechanism, not a loophole.
 *
 * `<progress>` itself is deliberately not used: it cannot be styled to the
 * brand's shape across browsers, and the ARIA role gives the same semantics
 * with none of that fight. */
export function Progress({ value, max = 100, label, hint, tone = "gold", className }: ProgressProps) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const pct = (clamped / safeMax) * 100;
  const fill: CSSProperties = { inlineSize: `${pct}%` };
  return (
    <div className={cx("ps-progress", `ps-progress--${tone}`, className)}>
      <div
        className="ps-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuetext={hint}
      >
        <div className="ps-progress__fill" style={fill} />
      </div>
      {hint ? <p className="ps-progress__hint">{hint}</p> : null}
    </div>
  );
}
