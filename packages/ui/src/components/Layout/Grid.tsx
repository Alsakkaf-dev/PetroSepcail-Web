import type { HTMLAttributes } from "react";
import { cx } from "../../utils/cx";
import { gapClass, type SpaceStep } from "./space";

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /** Column intent, not a fixed count: each variant is an `auto-fit` /
   * `minmax` track list, so the grid reflows to one column on a phone with
   * no media query at the call site. `2` = wide cards, `4` = KPI tiles. */
  cols?: "2" | "3" | "4";
  gap?: SpaceStep;
}

/** Responsive card/tile grid, matching `.grid--2/3/4` on the marketing site
 * so a product grid in the storefront and one on the brochure line up. */
export function Grid({ cols = "3", gap = "lg", className, children, ...rest }: GridProps) {
  return (
    <div className={cx("ps-grid", `ps-grid--${cols}`, gapClass(gap), className)} {...rest}>
      {children}
    </div>
  );
}
