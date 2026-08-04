import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, dirFor, type Locale } from "@petrospecial/i18n";

// Server-only. Kept in its own module (never re-exported from an index
// barrel) so a Client Component can never pull `next/headers` into its graph.

/**
 * The locale for this request.
 *
 * Read in the root layout so `<html lang dir>` is correct in the very first
 * byte of HTML. That matters more here than in most apps: the token file
 * keys the English type ramp off `html[lang="en"]`, so a hardcoded `lang`
 * silently applies Latin typography — and a collapsed --lh-ar of 1.7 instead
 * of 1.85 — to every Arabic screen in the platform.
 *
 * Resolution order follows FR-PC07-002 as far as this layer can see it:
 *   explicit ?lang= (deep links)  ->  ps-lang cookie  ->  default "ar".
 * A signed-in user's stored preference is written into the same cookie at
 * sign-in, so the identity setting is already reflected here.
 */
export function getLocale(searchParams?: { lang?: string | string[] }): Locale {
  const explicit = searchParams?.lang;
  if (explicit !== undefined) return parseLocale(explicit);
  return parseLocale(cookies().get(LOCALE_COOKIE)?.value);
}

/** `<html lang dir>` attributes for a root layout. */
export function htmlLangAttrs(locale: Locale): { lang: Locale; dir: "rtl" | "ltr" } {
  return { lang: locale, dir: dirFor(locale) };
}
