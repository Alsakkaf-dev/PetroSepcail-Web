import type { Metadata, Viewport } from "next";
import { getLocale, htmlLangAttrs } from "@petrospecial/app-shell/src/server";
import { LocaleProvider } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "PetroSpecial — Admin",
  description: "PetroSpecial admin center",
  // The console is never a public surface; keep it out of every index.
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  themeColor: "#16265c",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Was hardcoded lang="en" dir="ltr". Admin is the app that had no i18n at
  // all — every string was inline English — so it is also the app where the
  // hardcoded lang was least visible and most wrong.
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
