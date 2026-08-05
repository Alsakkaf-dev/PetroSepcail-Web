import type { ElementType, ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon, IconWell, type IconName, type IconWellTone } from "../../icons";

export interface NavTileProps {
  href: string;
  linkAs?: ElementType;
  icon?: IconName;
  tone?: IconWellTone;
  title: ReactNode;
  /** One line saying what is behind the door. A launcher without it is a list
   * of words someone has to click to understand. */
  description?: ReactNode;
  /** A live figure worth seeing before you go — an open-task count, an
   * unverified-proof queue. Already formatted and bidi-safe. */
  meta?: ReactNode;
  className?: string;
}

/** A destination card: icon well, title, one line, forward chevron.
 *
 * The whole card is the link — not a title-sized target inside a card — so
 * the tap area is the whole tile on a phone, and the chevron mirrors under
 * RTL because it is a directional glyph. */
export function NavTile({
  href,
  linkAs,
  icon,
  tone = "gold",
  title,
  description,
  meta,
  className
}: NavTileProps) {
  const Link: ElementType = linkAs ?? "a";
  return (
    <Link href={href} className={cx("ps-nav-tile", className)}>
      {icon ? (
        <span className="ps-nav-tile__icon">
          <IconWell name={icon} tone={tone} size="sm" />
        </span>
      ) : null}
      <span className="ps-nav-tile__body">
        <span className="ps-nav-tile__title">{title}</span>
        {description ? <span className="ps-nav-tile__desc">{description}</span> : null}
        {meta ? <span className="ps-nav-tile__meta">{meta}</span> : null}
      </span>
      <span className="ps-nav-tile__go" aria-hidden="true">
        <Icon name="chevron-forward" size="lg" />
      </span>
    </Link>
  );
}
