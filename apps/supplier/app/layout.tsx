import type { Metadata, Viewport } from "next";
import { getLocale, htmlLangAttrs } from "@petrospecial/app-shell/src/server";
import { LocaleProvider } from "@petrospecial/app-shell/src/client";
import { PortalShell, type ShellRailGroup } from "@petrospecial/app-shell/src/shell";
import { t } from "@petrospecial/i18n";
import { SignOutButton } from "../components/SignOutButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "PetroSpecial — Supplier",
  description: "PetroSpecial supplier portal",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "PS Supplier" },
  icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
  // A distributor's own account pages are nobody's search result.
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  // --blue. Kept literal because the browser chrome reads this before any
  // stylesheet loads, so var(--blue) is not resolvable here.
  themeColor: "#16265c",
  width: "device-width",
  initialScale: 1
};

// Eleven destinations — more than a header holds, so the portal gets the
// console rail. Grouped by what a distributor is actually doing: placing an
// order, settling money, or maintaining their own account.
//
// Replaces the flat row of eleven equal links every page used to render for
// itself, which had no current-page state, dropped `?lang=` on every click,
// and put Custody one link away from Invoices with nothing to say they are
// different kinds of money.
const RAIL: ShellRailGroup[] = [
  {
    items: [
      { href: "/dashboard", labelKey: "nav.dashboard", icon: "dashboard" },
      { href: "/orders", labelKey: "nav.orders", icon: "package" }
    ]
  },
  {
    labelKey: "shell.groupOrdering",
    items: [
      { href: "/catalog", labelKey: "nav.catalog", icon: "droplet" },
      { href: "/cart", labelKey: "nav.cart", icon: "cart" },
      { href: "/templates", labelKey: "nav.templates", icon: "clipboard" }
    ]
  },
  {
    labelKey: "shell.groupFinance",
    items: [
      { href: "/invoices", labelKey: "nav.invoices", icon: "receipt" },
      { href: "/statement", labelKey: "nav.statement", icon: "document" },
      { href: "/payments", labelKey: "nav.payments", icon: "banknote" },
      { href: "/custody", labelKey: "nav.custody", icon: "wallet" }
    ]
  },
  {
    labelKey: "shell.groupAccount",
    items: [
      { href: "/rewards", labelKey: "nav.rewards", icon: "star" },
      { href: "/profile", labelKey: "nav.profile", icon: "user" }
    ]
  }
];

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
        <LocaleProvider locale={locale}>
          <PortalShell
            portalKey="brand.portalSupplier"
            rail={RAIL}
            width="wide"
            actions={<SignOutButton />}
            bareRoutes={["/login"]}
            noRailRoutes={["/"]}
          >
            {children}
          </PortalShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
