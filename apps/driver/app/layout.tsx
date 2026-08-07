import type { Metadata, Viewport } from "next";
import { getLocale, htmlLangAttrs } from "@petrospecial/app-shell/src/server";
import { LocaleProvider } from "@petrospecial/app-shell/src/client";
import { PortalShell } from "@petrospecial/app-shell/src/shell";
import { t } from "@petrospecial/i18n";
import { OfflineBar } from "../components/OfflineBar";
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
  icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  // --blue, kept literal: browser chrome reads this before any stylesheet
  // loads, so var(--blue) is not resolvable here.
  themeColor: "#16265c",
  width: "device-width",
  initialScale: 1
};

// Four destinations, so the header nav is still the whole navigation — a
// rail would cost thumb-reach on a phone held one-handed for a full shift.
// The van/custody tab and the KPI screen are reached from the launcher
// rather than the header: they are consulted, not worked from.
const NAV = [
  { href: "/shift", labelKey: "nav.shift" },
  { href: "/manifest", labelKey: "nav.manifest" },
  { href: "/map", labelKey: "nav.route" },
  { href: "/audits", labelKey: "nav.audits" }
] as const;

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
        <LocaleProvider locale={locale}>
          <PortalShell
            portalKey="brand.portalDriver"
            nav={[...NAV]}
            bareRoutes={["/login"]}
            actions={<OfflineBar />}
          >
            {children}
          </PortalShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
