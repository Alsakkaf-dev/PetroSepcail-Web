// Presentation-only formatters. Nothing here computes a value.
//
// Every money, VAT, exposure, points and discount figure on every screen is
// server-resolved (NFR-SP-005: "the UI never computes a price, VAT, or
// exposure figure"). These functions take what the API already returned and
// decide how it looks — they never add, multiply, or re-derive it. That is
// why the money helpers accept the API's decimal *string* and never a number
// they were asked to sum.

import { bcp47, type Locale } from "./locale";
import { t } from "./t";

/** Asia/Riyadh, always — the platform has one operational timezone. */
export const TIMEZONE = "Asia/Riyadh";

/**
 * Western digits in both locales.
 *
 * FR-PC07-003 leaves "Arabic-Indic or Western digits" open behind a
 * [BUSINESS-CONFIRM] setting. Western is the conservative default: the
 * marketing site already sets every numeral in Montserrat and isolates it LTR
 * (`.ltr, .phone, time, code`), and SAR amounts, IBANs, VAT numbers, order
 * references and ZATCA UUIDs are all read against systems that print Western
 * digits. Recorded in DEFERRED-DECISIONS §4.
 */
const NUMERIC_LOCALE = "en-US";

const SAR_SYMBOL: Record<Locale, string> = { ar: "ر.س", en: "SAR" };

function groupDecimal(value: string, fractionDigits: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat(NUMERIC_LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(n);
}

/**
 * Money, exactly as the two locales write it:
 *   ar -> `57.50 ر.س`
 *   en -> `SAR 57.50`
 *
 * Always render inside a bidi isolate (the `.ps-ltr` class, or the <Money>
 * component which applies it) — an amount next to Arabic text reorders
 * without one.
 */
export function money(locale: Locale, amount: string | number): string {
  const raw = String(amount);
  // A non-numeric value is a placeholder the caller chose deliberately — the
  // k>=5 privacy suppression renders "—", and a pending figure may render "".
  // Affixing a currency to it would read as a real amount of nothing.
  if (!Number.isFinite(Number(raw))) return raw;
  const formatted = groupDecimal(raw, 2);
  return locale === "ar" ? `${formatted} ${SAR_SYMBOL.ar}` : `${SAR_SYMBOL.en} ${formatted}`;
}

/** A count with no currency — quantities, parcels, open invoices. */
export function count(value: string | number): string {
  return groupDecimal(String(value), 0);
}

/** Loyalty points. Whole numbers by definition (partial reversals floor). */
export function points(value: string | number): string {
  return groupDecimal(String(value), 0);
}

/** A server-supplied percentage, e.g. a tier discount or an on-time rate. */
export function percent(locale: Locale, value: string | number, fractionDigits = 0): string {
  const formatted = groupDecimal(String(value), fractionDigits);
  return locale === "ar" ? `${formatted}٪` : `${formatted}%`;
}

/**
 * `-u-nu-latn` is not cosmetic. Plain `ar-SA` formats dates with Arabic-Indic
 * digits (`٤ أغسطس ٢٠٢٦`) while every number above formats with Western ones,
 * so a manifest would have shown `١٣:٣٠` next to `57.50 ر.س` on the same row.
 * The digit decision is made once, at the top of this file, and this is the
 * one place that would otherwise quietly opt out of it.
 */
function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const tag = locale === "ar" ? "ar-SA-u-nu-latn" : bcp47(locale);
  return new Intl.DateTimeFormat(tag, { timeZone: TIMEZONE, ...options });
}

/** `4 Aug 2026` / `٤ أغسطس ٢٠٢٦` — Riyadh calendar day. */
export function date(locale: Locale, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return dateFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(d);
}

/** Date + 24h time, Riyadh. Used on timelines, audit rows and ledgers. */
export function dateTime(locale: Locale, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return dateFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(d);
}

/** Time only, Riyadh — delivery slots, ETAs. */
export function time(locale: Locale, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return dateFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/** The Riyadh calendar day an instant falls in, as a sortable `YYYY-MM-DD`.
 * `en-CA` is the shortest reliable way to get ISO order out of Intl. */
function riyadhDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}

/**
 * Group key and heading for a day of notifications, timeline entries or
 * ledger rows.
 *
 * "Today" and "Yesterday" are worth naming — they are the two a reader is
 * actually orienting against — and everything before that is dated. The day
 * boundary is Riyadh's, not the device's, so a customer reading at 01:00 in
 * another timezone sees the same grouping the operations team does.
 */
export function dayKey(locale: Locale, iso: string, now: Date = new Date()): { key: string; label: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { key: iso, label: iso };
  const key = riyadhDay(d);
  const today = riyadhDay(now);
  const yesterday = riyadhDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (key === today) return { key, label: t(locale, "notif.today") };
  if (key === yesterday) return { key, label: t(locale, "notif.yesterday") };
  return { key, label: date(locale, iso) };
}

/**
 * Shorten an opaque id for display.
 *
 * No screen may render a raw UUID as a user-facing label. Where the API gives
 * a name, show the name; where it does not, show this plus a copy control, so
 * the value is still reportable to support without pretending to be a
 * human-readable reference.
 */
export function shortId(id: string, visible = 8): string {
  if (id.length <= visible) return id;
  return `${id.slice(0, visible)}…`;
}

/**
 * Mask all but the last four characters of an account identifier (IBAN on the
 * supplier profile, per SCR-SP01-003 "IBAN masked").
 */
export function maskTail(value: string, visible = 4): string {
  const trimmed = value.replace(/\s+/g, "");
  if (trimmed.length <= visible) return trimmed;
  return `${"•".repeat(Math.max(4, trimmed.length - visible))}${trimmed.slice(-visible)}`;
}
