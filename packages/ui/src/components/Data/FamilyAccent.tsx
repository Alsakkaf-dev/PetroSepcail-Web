import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import type { ProductFamily } from "../../tokens";

export interface FamilyAccentProps {
  family: ProductFamily;
  children: ReactNode;
  /** `bar` (the default) draws the start-aligned accent stripe on a card or
   * a row; `chip` is the inline family label. */
  variant?: "bar" | "chip";
  className?: string;
}

/** Product-family colour coding — سبيشل, بتروتوريون, رافال — for instant
 * recognition in the catalog, the cart, an order and a driver's manifest.
 *
 * Carried as a start-aligned accent bar, which is a `border-inline-start` and
 * therefore mirrors on its own. Never the *only* signal: the family name is
 * always present as text too, because roughly one man in twelve cannot tell
 * these three apart by hue.
 *
 * Family colours are not status colours. `--f-raval` is the Raval product
 * line, not "error" — that distinction is the whole reason the semantic
 * status tokens exist. */
export function FamilyAccent({ family, children, variant = "bar", className }: FamilyAccentProps) {
  return (
    <span className={cx("ps-family", `ps-family--${variant}`, `ps-family--${family}`, className)}>{children}</span>
  );
}
