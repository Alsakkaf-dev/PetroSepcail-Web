import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

export type BadgeVariant = "neutral" | "gold" | "blue" | "flame";

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

/** PC-08 core set — small status/label chip. Every variant pairs its
 * background with `--ink` foreground text (not the accent color itself as
 * foreground) so contrast holds at any size — see a11y/contrast.test.ts. */
export function Badge({ children, variant = "neutral", className }: BadgeProps) {
  return <span className={cx("ps-badge", `ps-badge--${variant}`, className)}>{children}</span>;
}
