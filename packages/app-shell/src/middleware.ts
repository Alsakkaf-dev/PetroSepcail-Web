import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, parseLocale } from "@petrospecial/i18n";

/**
 * Makes `?lang=` and the `ps-lang` cookie agree.
 *
 * The root layout is a Server Component and reads the cookie to emit
 * `<html lang dir>`; a layout cannot see `searchParams`. Without this, a deep
 * link like `/catalog?lang=en` arriving with an Arabic cookie would render
 * English content inside `<html lang="ar" dir="rtl">` — English text laid out
 * right-to-left, with the Arabic type ramp applied.
 *
 * So a `?lang=` that disagrees with the cookie writes the cookie and the
 * request continues. One redirect-free pass; the layout then reads the value
 * the link asked for. It also makes deep links persist, which is what a
 * shared link should do.
 */
export function localeMiddleware(request: NextRequest): NextResponse {
  const response = NextResponse.next();

  const requested = request.nextUrl.searchParams.get("lang");
  if (requested === null) return response;

  const locale = parseLocale(requested);
  if (request.cookies.get(LOCALE_COOKIE)?.value === locale) return response;

  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax"
  });
  return response;
}

/**
 * Skip Next's internals and static assets — the locale only matters for
 * documents. Fonts in particular are hit on every cold page load and have no
 * business paying for middleware.
 */
export const localeMatcher = ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.json).*)"];
