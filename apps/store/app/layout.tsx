import type { Metadata, Viewport } from "next";
import { getLocale, htmlLangAttrs } from "@petrospecial/app-shell/src/server";
import { LocaleProvider } from "@petrospecial/app-shell/src/client";
import { PortalShell } from "@petrospecial/app-shell/src/shell";
import { t } from "@petrospecial/i18n";
import { HeaderBell } from "../components/HeaderBell";
import { SignOutButton } from "../components/SignOutButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "PetroSpecial — بتروسبيشل",
  description: "زيوت ومواد تشحيم سعودية الصنع — بتروسبيشل",
  icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" }
};

export const viewport: Viewport = {
  themeColor: "#16265c",
  width: "device-width",
  initialScale: 1
};

// Five destinations, which a header holds comfortably — the storefront is the
// one app with no console rail. Replaces the four hardcoded English <Link>s
// that used to sit inline-styled in this file with no active state, no
// translation, and a dropped locale on every click.
const NAV = [
  { href: "/catalog", labelKey: "nav.catalog" },
  { href: "/search", labelKey: "nav.search" },
  { href: "/orders", labelKey: "nav.orders" },
  { href: "/wishlist", labelKey: "nav.wishlist" },
  { href: "/account", labelKey: "nav.account" }
] as const;

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
          <PortalShell
            portalKey="brand.portalStore"
            nav={[...NAV]}
            width="flush"
            actions={
              <>
                <HeaderBell />
                <SignOutButton />
              </>
            }
          >
            {children}
          </PortalShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
