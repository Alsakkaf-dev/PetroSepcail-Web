import type { ElementType, ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";

export type ChipTone = "neutral" | "special" | "petro" | "raval";

export interface ChipProps {
  label: ReactNode;
  /** Makes the chip a link — a filter that lives in the URL, which is how a
   * filtered catalogue stays shareable and back-button-able. */
  href?: string;
  linkAs?: ElementType;
  selected?: boolean;
  /** A facet count. Already formatted and bidi-safe. */
  count?: string;
  tone?: ChipTone;
  /** Turns the chip into an active-filter chip with a remove control. The
   * remove target is its own button, so "remove this filter" and "go to this
   * filter" never share one hit area. */
  removeHref?: string;
  removeLabel?: string;
  className?: string;
}

/** A pill: a family filter, a facet value, an applied-filter chip.
 *
 * Matches the marketing site's `.brand-tab` and `.nav a` pill treatment, so a
 * filter row in the storefront and the family tabs on the brochure are
 * visibly the same control. */
export function Chip({
  label,
  href,
  linkAs,
  selected = false,
  count,
  tone = "neutral",
  removeHref,
  removeLabel,
  className
}: ChipProps) {
  const Link: ElementType = linkAs ?? "a";
  const classes = cx("ps-chip", `ps-chip--${tone}`, selected && "ps-chip--selected", className);

  const body = (
    <>
      <span className="ps-chip__label">{label}</span>
      {count ? (
        <span className="ps-chip__count">
          <bdi>{count}</bdi>
        </span>
      ) : null}
    </>
  );

  if (removeHref) {
    return (
      <span className={cx(classes, "ps-chip--removable")}>
        {body}
        <Link href={removeHref} className="ps-chip__remove" aria-label={removeLabel}>
          <Icon name="close" size="sm" />
        </Link>
      </span>
    );
  }

  if (href) {
    return (
      <Link href={href} className={classes} aria-current={selected ? "true" : undefined}>
        {body}
      </Link>
    );
  }

  return <span className={classes}>{body}</span>;
}
