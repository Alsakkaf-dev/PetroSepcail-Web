import { cx } from "../../utils/cx";
import { Icon } from "../../icons";

export const STAR_VALUES = [1, 2, 3, 4, 5] as const;

export interface RatingProps {
  /** 0..5 as the server returned it. */
  value: number;
  /** The rating in words — "4.2 من 5". Already localised and formatted.
   *
   * This is the content; the stars are the picture of it. Five identical
   * star images tell a screen reader nothing, and the exact figure is what
   * anyone comparing two products actually wants, so it is always shown and
   * never rounded. */
  label: string;
  /** "38 تقييماً" — the sample size, beside the average. An average with no
   * count behind it is a number pretending to be evidence. */
  count?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * A star rating.
 *
 * The drawing rounds to whole stars; `label` carries the exact value and is
 * the only part assistive technology sees. Deliberately no half-star clip —
 * a partial fill has a direction, and every way of expressing one in CSS is
 * physical, which is exactly the kind of thing this library does not let a
 * component branch on.
 */
export function Rating({ value, label, count, size = "md", className }: RatingProps) {
  const filled = Math.round(Math.min(Math.max(value, 0), 5));
  return (
    <span className={cx("ps-rating", `ps-rating--${size}`, className)}>
      <span className="ps-rating__stars" aria-hidden="true">
        {STAR_VALUES.map((star) => (
          <span key={star} className={cx("ps-rating__star", star <= filled && "ps-rating__star--on")}>
            <Icon name="star" size={size === "sm" ? "sm" : "md"} />
          </span>
        ))}
      </span>
      <span className="ps-rating__label">{label}</span>
      {count === undefined ? null : <span className="ps-rating__count">{count}</span>}
    </span>
  );
}
