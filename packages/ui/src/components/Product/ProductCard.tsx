import type { ElementType, ReactNode } from "react";
import { cx } from "../../utils/cx";
import { ProductThumb } from "./ProductThumb";
import type { ProductFamily } from "../../tokens";

export interface ProductCardProps {
  href: string;
  linkAs?: ElementType;
  name: string;
  family: ProductFamily;
  /** The family's own name — سبيشل / Special. Family colour is never the only
   * signal; roughly one man in twelve cannot tell the three apart by hue. */
  familyLabel: string;
  /** Latin, isolated by the thumb and by the spec line: `5W-30`, `DOT 4`. */
  grade: string;
  thumbSrc?: string | null;
  /** A `<Money>` — the component never formats a price itself. */
  price: ReactNode;
  /** "From", because the figure is the cheapest pack size. */
  priceLabel?: string;
  /** A `<StatusBadge>` or equivalent. */
  stock?: ReactNode;
  inStock?: boolean;
  /** Add-to-cart, wishlist. Sits above the card's own link overlay so it stays
   * clickable — and it must, because an out-of-stock SKU disables buying while
   * leaving the wishlist available (`SCR-SF01-002`). */
  actions?: ReactNode;
  className?: string;
}

/**
 * A SKU tile: picture, family, name, grade, from-price, stock.
 *
 * The whole card is clickable but only the product name is the link. The card
 * spreads that link over itself with a `::after` overlay, so a screen reader
 * and a keyboard get exactly one target announced by the product's name,
 * while a finger gets the whole tile. Nesting buttons inside an anchor — the
 * obvious alternative — is invalid HTML and breaks both.
 */
export function ProductCard({
  href,
  linkAs,
  name,
  family,
  familyLabel,
  grade,
  thumbSrc,
  price,
  priceLabel,
  stock,
  inStock = true,
  actions,
  className
}: ProductCardProps) {
  const Link: ElementType = linkAs ?? "a";

  return (
    <article className={cx("ps-product", !inStock && "ps-product--out", className)}>
      <div className="ps-product__media">
        <ProductThumb src={thumbSrc} alt={name} family={family} grade={grade} />
      </div>
      <div className="ps-product__body">
        <p className={cx("ps-product__family", `ps-family--${family}`)}>{familyLabel}</p>
        <h3 className="ps-product__name">
          <Link href={href} className="ps-product__link">
            {name}
          </Link>
        </h3>
        <p className="ps-product__grade ps-ltr">{grade}</p>
        <p className="ps-product__price">
          {priceLabel ? <span className="ps-product__price-label">{priceLabel}</span> : null}
          {price}
        </p>
        {stock ? <div className="ps-product__stock">{stock}</div> : null}
      </div>
      {actions ? <div className="ps-product__actions">{actions}</div> : null}
    </article>
  );
}
