import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

/** Brand variants plus the six D-04 status tones. The status tones exist so
 * no screen has to reach for a product-family colour to mean "something went
 * wrong" — `--f-raval` was serving as error red in about twenty places
 * before they existed. Prefer `<StatusBadge>` for anything D-04 covers; a
 * bare tone here is for the cases it doesn't. */
export type BadgeVariant =
  | "neutral"
  | "gold"
  | "blue"
  | "flame"
  | "info"
  | "progress"
  | "success"
  | "warn"
  | "danger";

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

/** PC-08 core set — small status/label chip. Every variant pairs a tinted
 * background with a foreground that clears 4.5:1 against it, asserted pair by
 * pair in a11y/contrast.test.ts — which is why none of them uses `--gold`,
 * `--gold-700` or `--flame` as text. */
export function Badge({ children, variant = "neutral", className }: BadgeProps) {
  return <span className={cx("ps-badge", `ps-badge--${variant}`, className)}>{children}</span>;
}
