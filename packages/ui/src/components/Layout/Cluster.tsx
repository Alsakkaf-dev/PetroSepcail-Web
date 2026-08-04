import type { HTMLAttributes } from "react";
import { cx } from "../../utils/cx";
import { gapClass, type SpaceStep } from "./space";

export interface ClusterProps extends HTMLAttributes<HTMLDivElement> {
  gap?: SpaceStep;
  align?: "center" | "start" | "end" | "baseline";
  /** `between` is the toolbar shape: content at the start, actions at the
   * end — and it mirrors for free, because flexbox resolves start/end from
   * the inherited direction. */
  justify?: "start" | "center" | "end" | "between";
  /** Wrapping is on by default: a row of filter chips must never force a
   * horizontal scrollbar at 360px. */
  wrap?: boolean;
}

/** Horizontal group that wraps — chips, badges, button rows, a label beside
 * its value, an icon beside its text.
 *
 * Nothing here names left or right. `start` and `end` come out of the
 * document direction, so a toolbar built once is correct in both Arabic and
 * English with no second code path. */
export function Cluster({
  gap = "sm",
  align = "center",
  justify = "start",
  wrap = true,
  className,
  children,
  ...rest
}: ClusterProps) {
  return (
    <div
      className={cx(
        "ps-cluster",
        `ps-cluster--align-${align}`,
        `ps-cluster--justify-${justify}`,
        !wrap && "ps-cluster--nowrap",
        gapClass(gap),
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
