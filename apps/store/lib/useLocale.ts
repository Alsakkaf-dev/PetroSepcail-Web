"use client";

// Locale for Client Components.
//
// Was: useSearchParams().get("lang"), which is why 27 files carry a
// <Suspense fallback={null}> + PageInner() wrapper — the App Router fails
// the build on useSearchParams outside a boundary. It also meant a page
// defaulted to Arabic whenever the URL lacked ?lang=, while the root layout
// read the cookie, so toggling to English gave Arabic content inside
// <html lang="en" dir="ltr">.
//
// Now both read the same value: the layout resolves it once per request and
// seeds LocaleProvider, and middleware folds any ?lang= deep link into the
// cookie first, so nothing has to parse the URL twice. The Suspense wrappers
// are no longer load-bearing and come out as each screen is rebuilt.
export { useLocale } from "@petrospecial/app-shell/src/client";
