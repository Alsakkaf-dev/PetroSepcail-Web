import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface RailProps extends HTMLAttributes<HTMLDivElement> {
  /** The narrow column: a filter rail, a nav rail, an order summary. */
  rail: ReactNode;
  children: ReactNode;
  width?: "narrow" | "standard";
  /** Which side the rail takes. `start` is the reading-order default, so it
   * lands on the left in English and the right in Arabic with no second
   * layout. */
  placement?: "start" | "end";
  /** Keeps the rail in view while the main column scrolls. Off by default:
   * a sticky rail taller than the viewport traps its own content. */
  sticky?: boolean;
}

/** Two-column split — rail plus main — collapsing to one column below 60em.
 *
 * Source order is rail, then main, and the stacked layout keeps exactly that
 * order: filters above the results they filter. Only `placement="end"` moves
 * the rail visually, and only on desktop, for the summary-panel case where
 * either reading order is correct.
 *
 * Every offset is a logical property, so nothing mirrors by hand. */
export function Rail({
  rail,
  children,
  width = "standard",
  placement = "start",
  sticky = false,
  className,
  ...rest
}: RailProps) {
  return (
    <div
      className={cx("ps-rail", `ps-rail--${width}`, `ps-rail--${placement}`, sticky && "ps-rail--sticky", className)}
      {...rest}
    >
      <div className="ps-rail__side">{rail}</div>
      <div className="ps-rail__main">{children}</div>
    </div>
  );
}
