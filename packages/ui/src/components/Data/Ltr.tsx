import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface LtrProps {
  children: ReactNode;
  /** `bdi` (the default) is a plain isolated run. Use `code` for a reference,
   * a coupon, a ZATCA UUID or a JSON fragment — the brand stylesheet already
   * treats `code` as a technical string. */
  as?: "bdi" | "code";
  /** Full value on hover, where the visible text is a truncation of it. */
  title?: string;
  className?: string;
}

/** A left-to-right island inside Arabic text.
 *
 * Every numeral, IBAN, VAT/CR number, phone, OTP, invoice number, coupon
 * code, plate, SKU, grade (`5W-30`), spec value and JSON blob on every screen
 * goes through here or through a component built on it (design language
 * §3.5). Without it, an amount followed by a phone number in an RTL paragraph
 * reorders into something nobody typed — which is exactly what `apps/supplier`
 * was doing at 32 call sites while its `.ps-ltr` class was undefined.
 *
 * `<bdi>` carries the isolation in HTML itself, so the value survives even
 * before a stylesheet loads; `.ps-ltr` adds the forced direction and the
 * Latin face on top.
 *
 * Money is the one numeral that does *not* belong here — `57.50 ر.س` has to
 * resolve by its own content, not be forced LTR. Use `<Money>`. */
export function Ltr({ children, as = "bdi", title, className }: LtrProps) {
  const Tag = as;
  return (
    <Tag className={cx("ps-ltr", className)} title={title}>
      {children}
    </Tag>
  );
}
