import type { HTMLAttributes } from "react";
import { cx } from "../../utils/cx";

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** `standard` = --container, `wide` = --container-wide (dense tables),
   * `narrow` = a single readable column (forms, auth, legal copy). */
  width?: "standard" | "wide" | "narrow";
}

/** Horizontal measure. Centres with `margin-inline`, so it is direction-safe
 * without a single left/right anywhere. Used inside a full-bleed `Section`;
 * `Page` already contains one for the common case. */
export function Container({ width = "standard", className, children, ...rest }: ContainerProps) {
  return (
    <div className={cx("ps-container", `ps-container--${width}`, className)} {...rest}>
      {children}
    </div>
  );
}
