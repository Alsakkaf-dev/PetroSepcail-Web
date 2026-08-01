import type { Metadata, Viewport } from "next";
import "./globals.css";

// DL-07/S11 handover's own documented gap: "PWA installability... explicitly
// not done." manifest.json (public/) + this metadata block are what the
// browser's own install-prompt heuristic actually checks (name, icons,
// start_url, display:standalone, served over HTTPS — Vercel already
// provides the last one). No service worker / offline caching is added here
// — that's a separate, larger scope than "installable" strictly requires.
export const metadata: Metadata = {
  title: "PetroSpecial — Driver",
  description: "PetroSpecial driver PWA",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "PS Driver" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" }
};

export const viewport: Viewport = {
  themeColor: "#16265c",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
