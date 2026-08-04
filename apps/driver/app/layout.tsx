import type { Metadata, Viewport } from "next";
import { getLocale, htmlLangAttrs } from "@petrospecial/app-shell/src/server";
import { LocaleProvider } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";
import "./globals.css";

// DL-07/S11 handover's own documented gap: "PWA installability... explicitly
// not done." manifest.json (public/) + this metadata block are what the
// browser's own install-prompt heuristic actually checks (name, icons,
// start_url, display:standalone, served over HTTPS — Vercel already
// provides the last one). The offline service worker lands with the sync
// queue it exists to serve, not before it.
export const metadata: Metadata = {
  title: "PetroSpecial — Driver",
  description: "PetroSpecial driver PWA",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "PS Driver" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" }
};

export const viewport: Viewport = {
  // --blue, kept literal: browser chrome reads this before any stylesheet
  // loads, so var(--blue) is not resolvable here.
  themeColor: "#16265c",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Was hardcoded lang="en" dir="ltr" — in an app whose every page then set
  // its own dir on <main> and whose default locale is Arabic.
  const locale = getLocale();

  return (
    <html {...htmlLangAttrs(locale)}>
      <body>
        <a className="ps-skip-link" href="#main">
          {t(locale, "common.skipToContent")}
        </a>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
