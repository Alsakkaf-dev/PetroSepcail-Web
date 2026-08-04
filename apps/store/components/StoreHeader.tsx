"use client";

import { usePathname } from "next/navigation";
import { Header } from "@petrospecial/ui";
import { LocaleSwitch, useLocale } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";

// The storefront's persistent shell. Replaces the four hardcoded English
// <Link>s that used to sit inline-styled in the root layout — they had no
// active state, no translation, and dropped the locale on every click.
//
// Nav labels come from the PC-07 dictionary; the current-page marker comes
// from the pathname, so `aria-current="page"` is real rather than guessed.
const NAV = [
  { href: "/catalog", key: "nav.catalog" },
  { href: "/search", key: "nav.search" },
  { href: "/orders", key: "nav.orders" },
  { href: "/wishlist", key: "nav.wishlist" },
  { href: "/account", key: "nav.account" }
] as const;

export function StoreHeader() {
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <Header
      logo={<span className="ps-wordmark">{locale === "ar" ? "بتروسبيشل" : "PetroSpecial"}</span>}
      navItems={NAV.map((item) => ({
        label: t(locale, item.key),
        href: item.href,
        // A section stays current for its detail pages too — /catalog/[slug]
        // is still "Products".
        current: pathname === item.href || pathname.startsWith(`${item.href}/`)
      }))}
      languageSlot={<LocaleSwitch />}
      menuLabel={t(locale, "common.menu")}
      closeMenuLabel={t(locale, "common.closeMenu")}
    />
  );
}
