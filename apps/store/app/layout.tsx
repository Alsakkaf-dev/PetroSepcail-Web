import type { Metadata, Viewport } from "next";
import { getLocale, htmlLangAttrs } from "@petrospecial/app-shell/src/server";
import { LocaleProvider } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";
import { StoreHeader } from "../components/StoreHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "PetroSpecial — بتروسبيشل",
  description: "زيوت ومواد تشحيم سعودية الصنع — بتروسبيشل"
};

export const viewport: Viewport = {
  themeColor: "#16265c",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Was hardcoded lang="en" dir="ltr" above a nav of four hardcoded English
  // links that dropped ?lang= — so clicking "Catalog" silently reset an
  // Arabic reader to Arabic-in-an-English-document.
  const locale = getLocale();

  return (
    <html {...htmlLangAttrs(locale)}>
      <body>
        <a className="ps-skip-link" href="#main">
          {t(locale, "common.skipToContent")}
        </a>
        <LocaleProvider locale={locale}>
          <StoreHeader />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
