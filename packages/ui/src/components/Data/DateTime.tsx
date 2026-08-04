import { date, dateTime, time, TIMEZONE, type Locale } from "@petrospecial/i18n";
import { cx } from "../../utils/cx";

export interface DateTimeProps {
  /** ISO 8601 instant from the API. */
  iso: string;
  locale: Locale;
  /** `dateTime` (the default) for ledgers, timelines and audit rows; `date`
   * for a calendar day; `time` for a delivery slot or an ETA. */
  variant?: "date" | "dateTime" | "time";
  className?: string;
}

const FORMATTERS = { date, dateTime, time } as const;

/** A timestamp in Asia/Riyadh — the platform has one operational timezone,
 * and a driver, an accountant and a customer must never be reading three.
 *
 * Renders a real `<time datetime>`, so the machine-readable instant is still
 * there for assistive tech and for anyone copying it, while the visible text
 * is the Riyadh-local rendering.
 *
 * Isolated but *not* forced LTR, and deliberately not given the Latin face:
 * the Arabic form is `4 أغسطس 2026، 13:30`, which is Arabic text carrying
 * Western digits and has to resolve by its own content. The marketing site's
 * blanket `time { direction: ltr; font-family: var(--font-latin) }` would set
 * an Arabic month name in Montserrat and push it to the wrong side. */
export function DateTime({ iso, locale, variant = "dateTime", className }: DateTimeProps) {
  return (
    <time dateTime={iso} className={cx("ps-datetime", className)} data-timezone={TIMEZONE}>
      {FORMATTERS[variant](locale, iso)}
    </time>
  );
}
