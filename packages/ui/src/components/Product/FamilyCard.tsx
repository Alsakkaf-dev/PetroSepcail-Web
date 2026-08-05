import type { ElementType } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import type { ProductFamily } from "../../tokens";

export interface FamilyCardProps {
  href: string;
  linkAs?: ElementType;
  family: ProductFamily;
  name: string;
  /** The family's own two-line introduction, as the API returns it in both
   * locales. */
  intro: string;
  /** Already formatted and bidi-safe — `count()` from packages/i18n. */
  skuCount: string;
  /** "12 products" said in words, since the count alone is just a number. */
  skuCountLabel: string;
  className?: string;
}

/** One of the three product families, as the catalogue landing shows them
 * (`SCR-SF01-001`).
 *
 * The family's colour arrives as a start-aligned accent bar and a tinted
 * header wash — `border-inline-start`, so it mirrors on its own — with the
 * family's name always spelled out beside it. */
export function FamilyCard({
  href,
  linkAs,
  family,
  name,
  intro,
  skuCount,
  skuCountLabel,
  className
}: FamilyCardProps) {
  const Link: ElementType = linkAs ?? "a";

  return (
    <Link href={href} className={cx("ps-family-card", `ps-family-card--${family}`, className)}>
      <span className="ps-family-card__head">
        <span className="ps-family-card__mark" aria-hidden="true">
          <Icon name="droplet" size="lg" />
        </span>
        <span className="ps-family-card__name">{name}</span>
      </span>
      <span className="ps-family-card__intro">{intro}</span>
      <span className="ps-family-card__count">
        <bdi>{skuCount}</bdi> {skuCountLabel}
        <span className="ps-family-card__go" aria-hidden="true">
          <Icon name="chevron-forward" size="md" />
        </span>
      </span>
    </Link>
  );
}
