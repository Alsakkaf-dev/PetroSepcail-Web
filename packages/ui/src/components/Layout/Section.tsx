import type { HTMLAttributes } from "react";
import { cx } from "../../utils/cx";

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  /** Surface wash. A surface is never an empty void (design language §3.1):
   * `mesh` is the gold aurora, `tint` the informational gradient, `warm` the
   * recessed panel. */
  tone?: "plain" | "warm" | "tint" | "mesh" | "mesh-soft";
  /** `app` is the dense default; `brochure` uses --section-pad. */
  air?: "app" | "brochure" | "none";
  /** Signature background motifs, drawn behind content at low opacity and
   * always hidden from assistive tech. `viscosity` is the oil-pour contour
   * set, `contours` the topographic ellipses. */
  decor?: "none" | "viscosity" | "contours";
}

/** A titled band of a screen. Renders a real `<section>`, so give it an
 * accessible name — `aria-labelledby` pointing at the SectionHead's heading
 * id, or `aria-label` — whenever more than one appears on a page. */
export function Section({ tone = "plain", air = "app", decor = "none", className, children, ...rest }: SectionProps) {
  return (
    <section
      className={cx("ps-section", `ps-section--${tone}`, `ps-section--air-${air}`, className)}
      {...rest}
    >
      {decor !== "none" ? <div className={cx("ps-section__decor", `ps-section__decor--${decor}`)} aria-hidden="true" /> : null}
      <div className="ps-section__body">{children}</div>
    </section>
  );
}
