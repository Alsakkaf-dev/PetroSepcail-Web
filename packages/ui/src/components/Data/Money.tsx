import { money, type Locale } from "@petrospecial/i18n";
import { cx } from "../../utils/cx";

export interface MoneyProps {
  /** The API's value, as it came back. Pass the decimal *string* where the
   * API returned one — re-parsing it to a float and back loses precision the
   * ledger cares about. */
  amount: string | number;
  locale: Locale;
  /** `strong` for the figure a screen is about (an order total, an exposure),
   * `muted` for a secondary line (VAT itemisation, an original price). */
  emphasis?: "normal" | "strong" | "muted";
  /** Struck through — an original price beside a discounted one. Announced
   * as such, not just drawn that way. */
  struck?: boolean;
  className?: string;
}

/** A currency figure: `57.50 ر.س` in Arabic, `SAR 57.50` in English.
 *
 * Isolated with `<bdi>` rather than forced LTR. The Arabic form ends in an
 * Arabic-script currency mark, so it has to resolve by its own content — a
 * forced `direction: ltr` would put ر.س on the wrong side of the number.
 *
 * The UI never computes money (NFR-SP-005). This formats what the server
 * already decided and nothing else; there is deliberately no `add`, no
 * `total`, and no VAT arithmetic anywhere in this component. */
export function Money({ amount, locale, emphasis = "normal", struck = false, className }: MoneyProps) {
  const text = money(locale, amount);
  const figure = (
    <bdi className={cx("ps-money", `ps-money--${emphasis}`, className)}>{text}</bdi>
  );
  return struck ? <s className="ps-money__struck">{figure}</s> : figure;
}
