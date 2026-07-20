import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PetroSpecial — Driver",
  description: "PetroSpecial driver PWA"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
