import type { Metadata, Viewport } from "next";
import { getLocale, htmlLangAttrs } from "@petrospecial/app-shell/src/server";
import { LocaleProvider } from "@petrospecial/app-shell/src/client";
import { PortalShell, type ShellRailGroup } from "@petrospecial/app-shell/src/shell";
import { t } from "@petrospecial/i18n";
import { SignOutButton } from "../components/SignOutButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "PetroSpecial — Admin",
  description: "PetroSpecial admin center",
  icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
  // The console is never a public surface; keep it out of every index.
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  themeColor: "#16265c",
  width: "device-width",
  initialScale: 1
};

// Ten destinations and no nav at all before this. Grouped by the kind of
// authority each one carries — running the catalogue, moving money, watching
// the platform — so the privacy surface, which is the only place customer PII
// can be read, is never one click away from a routine catalogue edit.
const RAIL: ShellRailGroup[] = [
  {
    items: [{ href: "/dashboard", labelKey: "nav.dashboard", icon: "dashboard" }]
  },
  {
    labelKey: "shell.groupCatalog",
    items: [
      { href: "/catalog", labelKey: "nav.catalog", icon: "droplet" },
      { href: "/promotions", labelKey: "nav.promotions", icon: "tag" }
    ]
  },
  {
    labelKey: "shell.groupFinance",
    items: [
      { href: "/finance", labelKey: "nav.finance", icon: "banknote" },
      { href: "/suppliers-credit", labelKey: "nav.suppliersCredit", icon: "building" }
    ]
  },
  {
    labelKey: "shell.groupOversight",
    items: [
      { href: "/interventions", labelKey: "nav.interventions", icon: "warning" },
      { href: "/fleet", labelKey: "nav.fleet", icon: "truck" },
      { href: "/audit", labelKey: "nav.auditLog", icon: "clipboard" },
      { href: "/users", labelKey: "nav.users", icon: "users" },
      { href: "/privacy", labelKey: "nav.privacy", icon: "shield" }
    ]
  }
];

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
        <LocaleProvider locale={locale}>
          <PortalShell
            portalKey="brand.portalAdmin"
            rail={RAIL}
            width="wide"
            actions={<SignOutButton />}
            noRailRoutes={["/"]}
          >
            {children}
          </PortalShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
