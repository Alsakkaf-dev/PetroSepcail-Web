import type { SVGProps } from "react";
import { cx } from "../utils/cx";
import { DIRECTIONAL, glyphs, type IconName } from "./glyphs";

/** Sized in `em` against the type scale, never px. Two reasons, one of them
 * a hard gate: an icon sized in px between 20 and 43 fails
 * a11y/contrast.test.ts's touch-target check, and an icon that doesn't track
 * its own line's font-size drifts out of alignment the moment the ramp
 * changes. `md` is 1.15em to match `.btn svg` on the marketing site. */
export type IconSize = "sm" | "md" | "lg" | "xl";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children" | "aria-label" | "aria-hidden"> {
  name: IconName;
  size?: IconSize;
  /** Give a label only when the icon is the *only* carrier of its meaning —
   * then it is announced as an image. Left off (the default) the icon is
   * decorative and hidden from assistive tech, which is right whenever a
   * visible text label sits beside it. */
  label?: string;
  /** Continuous rotation, for `spinner` only. Stops under reduced motion. */
  spin?: boolean;
}

/** The single icon API (DEFERRED-DECISIONS §4 item 17). Every glyph renders
 * through here so stroke weight, sizing, colour and the RTL mirroring rule
 * are decided once rather than per call site. */
export function Icon({ name, size = "md", label, spin = false, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx(
        "ps-icon",
        `ps-icon--${size}`,
        DIRECTIONAL.has(name) && "ps-icon--directional",
        spin && "ps-icon--spin",
        className
      )}
      {...rest}
    >
      {glyphs[name]}
    </svg>
  );
}

/** The oil-drop icon well — `--r-drop`, the brand's most distinctive shape
 * (design language §3.3). A card's icon sits in one of these, not on bare
 * surface. `tone` picks the wash; the icon inside always inherits it. */
export type IconWellTone = "gold" | "blue" | "success" | "danger" | "warn";

export interface IconWellProps {
  name: IconName;
  tone?: IconWellTone;
  size?: "sm" | "md";
  label?: string;
  className?: string;
}

export function IconWell({ name, tone = "gold", size = "md", label, className }: IconWellProps) {
  return (
    <span className={cx("ps-icon-well", `ps-icon-well--${tone}`, `ps-icon-well--${size}`, className)}>
      <Icon name={name} size={size === "sm" ? "lg" : "xl"} label={label} />
    </span>
  );
}
