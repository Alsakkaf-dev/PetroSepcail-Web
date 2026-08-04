import type { Metadata, Viewport } from "next";
import { getLocale, htmlLangAttrs } from "@petrospecial/app-shell/src/server";
import { LocaleProvider } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "PetroSpecial — Supplier",
  description: "PetroSpecial supplier portal",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "PS Supplier" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" }
};

export const viewport: Viewport = {
  // --blue. Kept literal because the browser chrome reads this before any
  // stylesheet loads, so var(--blue) is not resolvable here.
  themeColor: "#16265c",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Was hardcoded lang="ar" dir="rtl" — which ignored ?lang=en entirely and
  // wrapped an English <main dir="ltr"> in an Arabic RTL document.
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
