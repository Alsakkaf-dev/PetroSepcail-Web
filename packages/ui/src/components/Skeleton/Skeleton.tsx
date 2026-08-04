import { cx } from "../../utils/cx";

/** Widths as an enum rather than a number, because app code may not write an
 * inline style (the zero-inline-style gate greps `apps/` for `style={{`).
 * A skeleton only ever needs to approximate a line of text anyway. */
export type SkeletonWidth = "full" | "3/4" | "1/2" | "1/3" | "1/4";

export interface SkeletonProps {
  /** `line` for text, `block` for a card or image, `circle` for an avatar. */
  variant?: "line" | "block" | "circle";
  width?: SkeletonWidth;
  /** `block` only — how tall the placeholder box is, in the density ramp. */
  size?: "sm" | "md" | "lg";
  className?: string;
}

const WIDTH_CLASS: Record<SkeletonWidth, string> = {
  full: "ps-skeleton--w-full",
  "3/4": "ps-skeleton--w-3-4",
  "1/2": "ps-skeleton--w-1-2",
  "1/3": "ps-skeleton--w-1-3",
  "1/4": "ps-skeleton--w-1-4"
};

/** One shimmering placeholder shape.
 *
 * A loading screen is built out of these in the shape of the real content —
 * never a bare spinner in a content area (per-screen DoD §1). The shimmer
 * stops dead under `prefers-reduced-motion`; the guard is in this component's
 * own stylesheet rather than relying on the global one, because a
 * never-ending shimmer is the single most nauseating thing on a page for
 * someone who asked for less motion.
 *
 * Aria-hidden by design: the surrounding LoadingState owns the live region,
 * so a screen reader hears "loading" once instead of once per bar. */
export function Skeleton({ variant = "line", width = "full", size = "md", className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "ps-skeleton",
        `ps-skeleton--${variant}`,
        variant === "block" && `ps-skeleton--${size}`,
        variant !== "circle" && WIDTH_CLASS[width],
        className
      )}
    />
  );
}
