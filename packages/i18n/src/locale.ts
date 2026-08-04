// PC-07 locale primitives, shared by all four apps.
//
// Before this package each app carried its own copy of parseLocale/dirFor/
// otherLocale plus its own dictionary (store ~130 keys, supplier ~95, driver
// ~55, admin none at all), and 41 more strings were inlined as
// `locale === "ar" ? … : …` ternaries. One definition, four consumers.

export type Locale = "ar" | "en";

/** Arabic-first is the platform default (PC-07 FR-PC07-002): anything that is
 *  not explicitly "en" resolves to Arabic. There is no English-first app. */
export const DEFAULT_LOCALE: Locale = "ar";

export const LOCALES: readonly Locale[] = ["ar", "en"];

/**
 * The cookie the whole platform reads its locale from.
 *
 * A cookie rather than the previous `?lang=` query param because the root
 * layout is a Server Component and has to emit `<html lang dir>` before any
 * client code runs — and because `?lang=` survived no navigation that omitted
 * it, which is why the storefront nav silently reset the user to Arabic.
 *
 * Name matches the marketing site's own `localStorage` key so a visitor
 * crossing from petrospecial.com into the storefront keeps their choice.
 */
export const LOCALE_COOKIE = "ps-lang";

/** One year. The choice is a preference, not a session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseLocale(value: string | string[] | undefined | null): Locale {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "en" ? "en" : DEFAULT_LOCALE;
}

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function otherLocale(locale: Locale): Locale {
  return locale === "ar" ? "en" : "ar";
}

/** BCP 47 tag, for `Intl` and for the `lang` attribute. */
export function bcp47(locale: Locale): "ar-SA" | "en-US" {
  return locale === "ar" ? "ar-SA" : "en-US";
}
