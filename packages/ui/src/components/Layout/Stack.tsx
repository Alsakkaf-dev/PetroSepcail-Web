import type { HTMLAttributes } from "react";
import { cx } from "../../utils/cx";
import { gapClass, type SpaceStep } from "./space";

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  /** Vertical rhythm between children. Defaults to `md` (--d-3). */
  gap?: SpaceStep;
  /** Cross-axis alignment. `stretch` (the default) is what makes cards in a
   * stack share a width without anyone setting one. */
  align?: "stretch" | "start" | "center" | "end";
}

/** Vertical flow. The single most-used primitive in the system: almost every
 * screen is a Stack of Sections, and almost every card is a Stack of rows.
 *
 * Block direction never mirrors, so this primitive is direction-agnostic by
 * construction — which is exactly why spacing belongs here rather than in a
 * margin on each child. */
export function Stack({ gap = "md", align = "stretch", className, children, ...rest }: StackProps) {
  return (
    <div className={cx("ps-stack", `ps-stack--${align}`, gapClass(gap), className)} {...rest}>
      {children}
    </div>
  );
}
