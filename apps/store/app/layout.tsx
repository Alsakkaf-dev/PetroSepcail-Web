import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "PetroSpecial — Store",
  description: "PetroSpecial customer storefront"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <nav style={{ display: "flex", gap: 16, padding: 12, borderBottom: "1px solid var(--line)" }}>
          <Link href="/">PetroSpecial</Link>
          <Link href="/catalog">Catalog</Link>
          <Link href="/search">Search</Link>
          <Link href="/cart" style={{ marginInlineStart: "auto" }}>
            Cart
          </Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
