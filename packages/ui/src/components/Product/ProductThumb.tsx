import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import type { ProductFamily } from "../../tokens";

export interface ProductThumbProps {
  /** The API's `thumbUrl`. Null for most of the catalogue by design — only
   * four of the twenty-three SKUs have real photography. */
  src?: string | null;
  /** The product name. Empty on the placeholder, which carries no
   * information a screen reader needs twice — the card already says the name
   * and the grade. */
  alt: string;
  family: ProductFamily;
  /** Set on the placeholder in Latin, isolated: `5W-30`, `DOT 4`, `ATF`. */
  grade: string;
  size?: "md" | "lg";
  className?: string;
}

/**
 * A product's picture, or the family/grade placeholder that stands in for one.
 *
 * The placeholder is not a fallback bolted on afterwards — it is what the
 * catalogue seed itself specifies for the nineteen SKUs with no photograph
 * ("the rest render a generated family/grade placeholder", `0023_catalog_seed`),
 * and TC-SF01-007 tests for it. It did not exist, which is why every tile in
 * production was an empty beige box with a bare viscosity string floating in
 * it.
 *
 * What replaces that: the family's own colour as a soft wash, the brand's
 * droplet in an oil-drop well, and the grade set as a proper label. It reads
 * as a deliberate mark rather than as a missing image, and it never pretends
 * to be a photograph of a bottle nobody has photographed.
 */
export function ProductThumb({ src, alt, family, grade, size = "md", className }: ProductThumbProps) {
  if (src) {
    return (
      <span className={cx("ps-thumb", `ps-thumb--${size}`, className)}>
        <img className="ps-thumb__img" src={src} alt={alt} loading="lazy" />
      </span>
    );
  }

  return (
    <span
      className={cx("ps-thumb", "ps-thumb--placeholder", `ps-thumb--${family}`, `ps-thumb--${size}`, className)}
      // Decorative: everything it says, the card says in text.
      aria-hidden="true"
    >
      <span className="ps-thumb__mark">
        <Icon name="droplet" size="xl" />
      </span>
      <span className="ps-thumb__grade ps-ltr">{grade}</span>
    </span>
  );
}
