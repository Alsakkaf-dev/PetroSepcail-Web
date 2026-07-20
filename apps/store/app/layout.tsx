import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PetroSpecial — Store",
  description: "PetroSpecial customer storefront"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
